import { decodeFrame } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { TurnLog } from "../src/turn-log.ts";

describe("TurnLog", () => {
  it("replays any suffix of the game, split into frames", () => {
    const log = new TurnLog();
    for (let tick = 0; tick < 10_000; tick++) {
      log.append(tick % 7 === 0 ? [{ player: 1, order: { type: "spawn", tile: tick } }] : []);
    }
    expect(log.length).toBe(10_000);

    const frames = [...log.frames(1_234, 4_000)];
    expect(frames).toHaveLength(3);
    const turns = frames.flatMap((frame) => {
      const decoded = decodeFrame(frame);
      return decoded.kind === "turns" ? decoded.turns : [];
    });
    expect(turns.map((turn) => turn.tick)).toEqual(
      Array.from({ length: 10_000 - 1_234 }, (_, index) => 1_234 + index),
    );
    expect(turns[1_239 - 1_234]?.orders).toEqual([
      { player: 1, order: { type: "spawn", tile: 1_239 } },
    ]);
  });

  it("has nothing to send past its end", () => {
    const log = new TurnLog();
    log.append([]);
    expect([...log.frames(1)]).toEqual([]);
  });

  it("stores an hour of quiet turns in well under a megabyte", () => {
    const log = new TurnLog();
    for (let tick = 0; tick < 36_000; tick++) log.append([]);
    expect(log.byteLength).toBeLessThan(400_000);
  });

  it("loads what it exported into an empty log, which then grows as before", () => {
    const log = new TurnLog();
    for (let tick = 0; tick < 3_000; tick++) {
      log.append(tick % 5 === 0 ? [{ player: 2, order: { type: "spawn", tile: tick } }] : []);
    }
    const { bodies, ends } = log.export();
    const copy = new TurnLog();
    expect(copy.load(bodies, ends)).toBe(true);
    expect(copy.length).toBe(3_000);
    expect(copy.byteLength).toBeGreaterThan(0);
    expect([...copy.frames(0)]).toEqual([...log.frames(0)]);
    copy.append([{ player: 1, order: { type: "spawn", tile: 9 } }]);
    const last = decodeFrame([...copy.frames(3_000)][0] ?? new Uint8Array());
    expect(last).toEqual({
      kind: "turns",
      turns: [{ tick: 3_000, orders: [{ player: 1, order: { type: "spawn", tile: 9 } }] }],
    });
    expect(copy.load(bodies, ends)).toBe(false);
  });

  it("refuses a log whose ends do not fit its bodies, or whose turns do not decode", () => {
    const log = new TurnLog();
    log.append([{ player: 1, order: { type: "spawn", tile: 3 } }]);
    log.append([]);
    const { bodies, ends } = log.export();
    expect(new TurnLog().load(bodies, Uint32Array.from([2, 1]))).toBe(false);
    expect(new TurnLog().load(bodies, Uint32Array.from([1]))).toBe(false);
    const broken = bodies.slice();
    broken[2] = 200;
    const refused = new TurnLog();
    expect(refused.load(broken, ends)).toBe(false);
    expect(refused.length).toBe(0);
    expect(new TurnLog().load(new Uint8Array(), new Uint32Array())).toBe(true);
  });

  it("runs on to the turns logged while its frames are read", () => {
    const log = new TurnLog();
    for (let tick = 0; tick < 5; tick++) log.append([]);
    const ticks: number[] = [];
    for (const frame of log.frames(0, 3)) {
      const decoded = decodeFrame(frame);
      if (decoded.kind === "turns") ticks.push(...decoded.turns.map((turn) => turn.tick));
      if (log.length < 9) log.append([]);
    }
    expect(ticks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
