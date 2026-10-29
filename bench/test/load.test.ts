import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { createGameServer } from "@frontfall/server";
import { describe, expect, it } from "vitest";
import { Histogram } from "../server/histogram.ts";
import type { GameData } from "../server/client.ts";
import { isSlow, mergeSamples, runLoad, summarizeLoad, type LoadSample } from "../server/load.ts";
import { saturation, serverWindow } from "../server/report.ts";
import type { ServerStats } from "../server/serve.ts";

describe("Histogram", () => {
  it("reports percentiles to a tenth of a millisecond and the exact maximum", () => {
    const histogram = new Histogram();
    for (let i = 1; i <= 100; i++) histogram.record(i);
    histogram.record(123.456);
    const summary = histogram.summary();
    expect(summary.samples).toBe(101);
    expect(summary.p50).toBeCloseTo(51, 5);
    expect(summary.p95).toBeCloseTo(96, 5);
    expect(summary.max).toBe(123.456);
  });

  it("adds up histograms and keeps outliers in the last bucket", () => {
    const a = new Histogram();
    const b = new Histogram();
    a.record(100);
    b.record(60_000);
    a.add(b);
    expect(a.summary()).toMatchObject({ samples: 2, p50: 100, max: 60_000 });
    expect(() => new Histogram().summary()).toThrow(RangeError);
  });
});

function game(id: string, intervals: number[], turns: number[]): GameData {
  const histogram = new Histogram();
  for (const interval of intervals) histogram.record(interval);
  return {
    id,
    // Through JSON, as between processes.
    intervals: JSON.parse(JSON.stringify(histogram.toData())) as GameData["intervals"],
    orderLatency: new Histogram().toData(),
    outOfOrder: 0,
    changedTurns: 0,
    desyncs: 0,
    ordersSent: 1,
    ordersSeen: 1,
    turnsPerClient: turns,
  };
}

function sample(games: GameData[], p99: number): LoadSample {
  return {
    games,
    clients: games.reduce((sum, { turnsPerClient }) => sum + turnsPerClient.length, 0),
    slowClients: 0,
    connectMs: 10,
    clientLoopDelay: { p99, max: p99 * 2 },
  };
}

describe("client processes", () => {
  it("serializes a histogram without losing a bucket", () => {
    const histogram = new Histogram();
    for (let i = 0; i < 1000; i++) histogram.record(95 + (i % 11));
    const copy = Histogram.fromData(JSON.parse(JSON.stringify(histogram.toData())) as never);
    expect(copy.summary()).toEqual(histogram.summary());
    expect(Histogram.fromData(new Histogram().toData()).samples).toBe(0);
  });

  it("merges the samples of several processes as one", () => {
    const merged = summarizeLoad(
      mergeSamples([
        sample([game("a", [100, 101], [50, 50]), game("b", [100], [40])], 3),
        sample([game("a", [130], [49]), game("c", [99], [10])], 7),
      ]),
    );
    expect(merged.games.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(merged.games[0]).toMatchObject({
      players: 3,
      minTurns: 49,
      maxTurns: 50,
      ordersSent: 2,
    });
    expect(merged.games[0]?.interval?.max).toBe(130);
    expect(merged.interval.samples).toBe(5);
    expect(merged.clients).toBe(5);
    expect(merged.clientLoopDelay).toEqual({ p99: 7, max: 14 });
  });

  it("spreads slow clients evenly", () => {
    const slow = Array.from({ length: 100 }, (_, index) => isSlow(index, 10));
    expect(slow.filter(Boolean)).toHaveLength(10);
    expect(slow.slice(0, 10).filter(Boolean)).toHaveLength(1);
  });

  it("calls a step saturated from 20 ms of lateness or 50 ms of server loop delay", () => {
    const stats = (loopP99: number, cpuMicros: number): ServerStats => ({
      cpu: { user: cpuMicros, system: 0 },
      rssBytes: 0,
      peakRssBytes: 0,
      heapUsedBytes: 0,
      peakHeapUsedBytes: 0,
      loopDelay: { p99: loopP99, max: loopP99 },
      turnPasses: { count: 0, sumSeconds: 0, buckets: [] },
    });
    const report = (interval: number) => summarizeLoad(sample([game("a", [interval], [1])], 1));
    const window = serverWindow(stats(0, 0), stats(10, 500_000), 1000);
    expect(window.cpuPercent).toBeCloseTo(50, 5);
    expect(saturation({ games: 1, report: report(119), server: window })).toBeUndefined();
    expect(saturation({ games: 1, report: report(121), server: window })).toMatch(/lateness/);
    const busy = serverWindow(stats(0, 0), stats(51, 0), 1000);
    expect(saturation({ games: 1, report: report(100), server: busy })).toMatch(/loop/);
  });
});

describe("server load", () => {
  it("delivers every turn in order and on time to 2 games of 8 players", async () => {
    const server = createGameServer({ staticRoot: tmpdir(), version: "load" });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const { port } = server.http.address() as AddressInfo;
    try {
      const report = await runLoad({
        url: `ws://127.0.0.1:${String(port)}/ws`,
        games: 2,
        players: 8,
        durationMs: 10_000,
        mode: "private",
        orderIntervalMs: 2000,
        mapTiles: 4096 * 2048,
      });

      expect(report.games).toHaveLength(2);
      for (const game of report.games) {
        expect(game.players).toBe(8);
        expect(game.outOfOrder).toBe(0);
        expect(game.desyncs).toBe(0);
        // Counts are taken at one instant; a turn may still be in flight to some clients.
        expect(game.maxTurns - game.minTurns).toBeLessThanOrEqual(1);
        expect(game.minTurns).toBeGreaterThanOrEqual(80);
        expect(game.ordersSeen).toBeGreaterThan(0);
        expect(game.ordersSeen).toBeGreaterThanOrEqual(game.ordersSent - game.players);
      }
      expect(report.interval.p95).toBeLessThan(300);
    } finally {
      await server.close();
    }
  }, 20_000);
});
