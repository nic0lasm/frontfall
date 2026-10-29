/**
 * Game server for `pnpm load -- --spawn-server`, run in a child process so its
 * CPU time and memory are measured apart from the simulated clients'.
 */
import { tmpdir } from "node:os";
import { createGameServer } from "@frontfall/server";
import { LoopDelay, type LoopDelaySummary } from "./loop-delay.ts";

/** frontfall_turn_duration_seconds as rendered for /metrics, counted since the start. */
export interface TurnPasses {
  count: number;
  sumSeconds: number;
  /** [upper bound in seconds, passes at most that long], cumulative as in Prometheus. */
  buckets: [number, number][];
}

export interface ServerStats {
  /** process.cpuUsage(), in microseconds. */
  cpu: { user: number; system: number };
  rssBytes: number;
  peakRssBytes: number;
  heapUsedBytes: number;
  peakHeapUsedBytes: number;
  /** Event loop delay since the previous "stats" request, in ms. */
  loopDelay: LoopDelaySummary;
  turnPasses: TurnPasses;
}

/** "sample" reads the same as "stats" but leaves the loop delay running. */
export type ServerRequest = "stats" | "sample" | "stop";

const players = Number(process.env.LOAD_PLAYERS ?? 16);
const server = createGameServer({
  // The run never requests a page.
  staticRoot: tmpdir(),
  version: "load",
  // Stopping the bench ends its games at once.
  drainMs: 0,
  publicGame: { capacity: players, countdownMs: 1000 },
});

const loopDelay = new LoopDelay();
let peakRssBytes = 0;
let peakHeapUsedBytes = 0;
function memory(): { rss: number; heapUsed: number } {
  const { rss, heapUsed } = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, rss);
  peakHeapUsedBytes = Math.max(peakHeapUsedBytes, heapUsed);
  return { rss, heapUsed };
}
setInterval(memory, 1000).unref();

/** Reads the turn histogram from its Prometheus lines, which is all the server exposes of it. */
function turnPasses(): TurnPasses {
  const passes: TurnPasses = { count: 0, sumSeconds: 0, buckets: [] };
  for (const line of server.metrics.turnDuration.render()) {
    const bucket = /_bucket\{le="([^"]+)"\} (\S+)$/.exec(line);
    if (bucket) {
      // +Inf is `count`, and JSON has no Infinity.
      if (bucket[1] !== "+Inf") passes.buckets.push([Number(bucket[1]), Number(bucket[2])]);
    } else if (line.includes("_sum ")) passes.sumSeconds = Number(line.split(" ")[1]);
    else if (line.includes("_count ")) passes.count = Number(line.split(" ")[1]);
  }
  return passes;
}

// The bench died: nothing will stop this server.
process.on("disconnect", () => {
  process.exit(1);
});

process.on("message", (request: ServerRequest) => {
  if (request === "stop") {
    void server.close().then(() => process.exit(0));
    return;
  }
  const { rss, heapUsed } = memory();
  const stats: ServerStats = {
    cpu: process.cpuUsage(),
    rssBytes: rss,
    peakRssBytes,
    heapUsedBytes: heapUsed,
    peakHeapUsedBytes,
    loopDelay: loopDelay.summary(),
    turnPasses: turnPasses(),
  };
  if (request === "stats") loopDelay.reset();
  process.send?.(stats);
});

server.http.listen(0, "127.0.0.1", () => {
  const address = server.http.address();
  process.send?.({ port: typeof address === "object" && address ? address.port : 0 });
});
