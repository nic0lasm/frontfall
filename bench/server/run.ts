import { fork, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  formatRejoin,
  formatReport,
  summarizeLoad,
  summarizeRejoin,
  type RejoinReport,
  type SessionOptions,
} from "./load.ts";
import { ForkedPool, LocalPool, type ClientPool } from "./pool.ts";
import {
  CLIENT_BOUND_LOOP_MS,
  formatRamp,
  formatServer,
  formatTimeline,
  mib,
  saturation,
  serverWindow,
  type MemorySample,
  type RampStep,
} from "./report.ts";
import type { ServerRequest, ServerStats } from "./serve.ts";

const { values } = parseArgs({
  // `pnpm load -- --games 2` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    games: { type: "string", default: "20" },
    players: { type: "string", default: "16" },
    minutes: { type: "string", default: "30" },
    url: { type: "string", default: "ws://localhost:8080/ws" },
    "spawn-server": { type: "boolean", default: false },
    public: { type: "boolean", default: false },
    "order-interval": { type: "string", default: "2000" },
    "map-tiles": { type: "string", default: String(4096 * 2048) },
    "client-procs": { type: "string", default: "1" },
    "heap-mib": { type: "string" },
    "server-limits": { type: "boolean", default: false },
    "max-players": { type: "string" },
    "max-connections": { type: "string" },
    "rejoin-storm": { type: "string" },
    "rejoin-from-zero": { type: "boolean", default: false },
    "slow-clients": { type: "string" },
    ramp: { type: "string" },
    "sample-seconds": { type: "string", default: "10" },
    json: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function positive(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    fail(`--${name} must be a positive number, got ${raw}`);
  return value;
}

const players = Math.round(positive("players", values.players));
const minutes = positive("minutes", values.minutes);
const clientProcs = Math.round(positive("client-procs", values["client-procs"]));
const heapMiB =
  values["heap-mib"] === undefined ? undefined : positive("heap-mib", values["heap-mib"]);
const stormSeconds =
  values["rejoin-storm"] === undefined
    ? undefined
    : positive("rejoin-storm", values["rejoin-storm"]);
const fromZero = values["rejoin-from-zero"];
const maxPlayers =
  values["max-players"] === undefined ? undefined : positive("max-players", values["max-players"]);
const maxConnections =
  values["max-connections"] === undefined
    ? undefined
    : positive("max-connections", values["max-connections"]);
// The bench lifts the server's admission limits unless asked to test them.
const serverLimits =
  values["server-limits"] || maxPlayers !== undefined || maxConnections !== undefined;
const slowPercent =
  values["slow-clients"] === undefined ? 0 : positive("slow-clients", values["slow-clients"]);
const sampleMs = positive("sample-seconds", values["sample-seconds"]) * 1000;
const steps = values.ramp
  ? values.ramp.split(",").map((games) => Math.round(positive("ramp", games)))
  : [Math.round(positive("games", values.games))];

if (fromZero && stormSeconds === undefined) fail("--rejoin-from-zero needs --rejoin-storm <s>");
if (stormSeconds !== undefined && stormSeconds >= minutes * 60)
  fail("--rejoin-storm must come before the end of the run");
if (stormSeconds !== undefined && steps.length > 1) fail("--rejoin-storm cannot run with --ramp");
if (slowPercent >= 100) fail("--slow-clients must leave some clients reading");
if (steps.some((games, index) => index > 0 && games <= (steps[index - 1] ?? 0)))
  fail("--ramp takes increasing game counts, such as 50,100,200");

/** The server child, answering one request at a time. */
class SpawnedServer {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly url: string,
    private readonly child: ChildProcess,
  ) {}

  /** Starts serve.ts in a child process and resolves once it listens. */
  static async start(): Promise<SpawnedServer> {
    const execArgv = ["--import", "tsx"];
    // Like production, where the heap is capped.
    if (heapMiB !== undefined) execArgv.push(`--max-old-space-size=${String(heapMiB)}`);
    const child = fork(fileURLToPath(new URL("serve.ts", import.meta.url)), {
      execArgv,
      env: {
        ...process.env,
        LOAD_PLAYERS: String(players),
        LOAD_SERVER_LIMITS: serverLimits ? "1" : "0",
        LOAD_MAX_PLAYERS: maxPlayers === undefined ? "" : String(maxPlayers),
        LOAD_MAX_CONNECTIONS: maxConnections === undefined ? "" : String(maxConnections),
      },
    });
    const port = await new Promise<number>((resolve, reject) => {
      child.once("message", (message: { port: number }) => {
        resolve(message.port);
      });
      child.once("exit", (code) => {
        reject(new Error(`server exited with ${String(code)}`));
      });
    });
    return new SpawnedServer(`ws://127.0.0.1:${String(port)}/ws`, child);
  }

  request(what: Exclude<ServerRequest, "stop">): Promise<ServerStats> {
    const reply = this.queue.then(
      () =>
        new Promise<ServerStats>((resolve) => {
          this.child.once("message", resolve);
          this.child.send(what);
        }),
    );
    this.queue = reply;
    return reply;
  }

  /** After the requests still queued, such as a memory sample. */
  stop(): void {
    void this.queue.then(() => {
      if (this.child.connected) this.child.send("stop" satisfies ServerRequest);
    });
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill();
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const server = values["spawn-server"] ? await SpawnedServer.start() : undefined;
const url = server?.url ?? values.url;
const mode = values.public ? "public" : "private";
console.log(
  `Node ${process.version}, ${String(cpus().length)} × ${cpus()[0]?.model ?? "unknown CPU"}, ${mib(totalmem())} MiB`,
);
const games = steps.join(" → ");
console.log(
  `${games} ${mode} games × ${String(players)} players for ${String(minutes)} min${steps.length > 1 ? " per step" : ""} against ${url}, clients in ${String(clientProcs)} process${clientProcs > 1 ? "es" : ""}${heapMiB === undefined ? "" : `, server heap ${String(heapMiB)} MiB`}`,
);

const sessionOptions: SessionOptions = {
  url,
  players,
  mode,
  orderIntervalMs: positive("order-interval", values["order-interval"]),
  mapTiles: Math.round(positive("map-tiles", values["map-tiles"])),
  slowPercent,
};
const pool: ClientPool =
  clientProcs > 1 ? new ForkedPool(sessionOptions, clientProcs) : new LocalPool(sessionOptions);
// A failure anywhere must not leave the server or client processes behind.
process.on("exit", () => {
  server?.kill();
  pool.kill();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    process.exit(130);
  });
}

const runStart = performance.now();
const timeline: MemorySample[] = [];
const sampler = setInterval(() => {
  void server?.request("sample").then((stats) => {
    timeline.push({
      seconds: Math.round((performance.now() - runStart) / 1000),
      rssBytes: stats.rssBytes,
      heapUsedBytes: stats.heapUsedBytes,
    });
  });
}, sampleMs);
let stepStart = runStart;
const progress = setInterval(() => {
  void pool.progress().then((turns) => {
    const seconds = Math.round((performance.now() - stepStart) / 1000);
    const last = timeline.at(-1);
    const memory = last ? `, server RSS ${mib(last.rssBytes)} MiB` : "";
    console.log(
      `${String(seconds)} s: ${String(turns.min)} to ${String(turns.max)} turns per client${memory}`,
    );
  });
}, 30_000);

const durationMs = minutes * 60_000;
const results: RampStep[] = [];
let rejoin: RejoinReport | undefined;
let added = 0;
for (const [index, target] of steps.entries()) {
  const last = index === steps.length - 1;
  const connectMs = await pool.add(
    Array.from({ length: target - added }, (_, game) => added + game),
  );
  added = target;
  if (steps.length > 1) {
    console.log(
      `\nStep ${String(index + 1)}: ${String(target)} games, joined in ${connectMs.toFixed(0)} ms`,
    );
  }
  // Measures start once every game of the step plays.
  await pool.sample();
  const before = await server?.request("stats");
  stepStart = performance.now();
  if (stormSeconds !== undefined) {
    await sleep(stormSeconds * 1000);
    console.log(`${String(stormSeconds)} s: every client drops its socket and rejoins`);
    rejoin = summarizeRejoin(await pool.rejoinStorm(fromZero));
    console.log(formatRejoin(rejoin, fromZero));
  }
  await sleep(stepStart + durationMs - performance.now());
  const sample = last ? await pool.stop() : await pool.sample();
  const wallMs = performance.now() - stepStart;
  const after = await server?.request("stats");
  const step: RampStep = {
    games: target,
    report: summarizeLoad({ ...sample, connectMs }),
    server: before && after ? serverWindow(before, after, wallMs) : undefined,
  };
  results.push(step);
  if (steps.length > 1) {
    const { interval } = step.report;
    console.log(
      `${String(interval.samples)} turn intervals, p95 ${interval.p95.toFixed(1)} ms, max ${interval.max.toFixed(1)} ms${step.server ? `; ${formatServer(step.server)}` : ""}`,
    );
  }
}
clearInterval(progress);
clearInterval(sampler);
server?.stop();

const final = results.at(-1);
if (!final) throw new Error("no step ran");
if (steps.length > 1) {
  console.log(`\n${formatRamp(results)}`);
  const first = results.find((step) => saturation(step) !== undefined);
  console.log(
    first
      ? `\nSaturated from ${String(first.games)} games (${String(first.report.clients)} players): ${saturation(first) ?? ""}.`
      : "\nNo step saturated the server.",
  );
} else {
  console.log(`\n${formatReport(final.report)}`);
  if (final.server) console.log(formatServer(final.server));
}
if (rejoin) console.log(formatRejoin(rejoin, fromZero));
if (slowPercent > 0 && timeline.length > 0) {
  console.log(`\nServer memory with ${String(slowPercent)} % of the clients not reading:\n`);
  console.log(formatTimeline(timeline));
}
const worstClientLoop = Math.max(...results.map((step) => step.report.clientLoopDelay.p99));
if (worstClientLoop > CLIENT_BOUND_LOOP_MS) {
  console.log(
    `\nThe client event loop ran ${worstClientLoop.toFixed(1)} ms late at p99: the clients, not the server, may cause the lateness. Try --client-procs ${String(Math.min(cpus().length, clientProcs * 2))}.`,
  );
}

if (values.json) {
  writeFileSync(
    values.json,
    `${JSON.stringify(
      {
        node: process.version,
        games: steps.at(-1),
        players,
        minutes,
        clientProcs,
        heapMiB,
        mode,
        report: final.report,
        server: final.server,
        steps: steps.length > 1 ? results : undefined,
        rejoin,
        slowPercent,
        timeline,
      },
      null,
      2,
    )}\n`,
  );
}

const broken = final.report.games.filter(
  (game) =>
    game.outOfOrder > 0 ||
    game.changedTurns > 0 ||
    game.desyncs > 0 ||
    game.maxTurns - game.minTurns > 1,
);
if (broken.length > 0) {
  console.error(`\n${String(broken.length)} games lost, reordered, changed or desynced turns.`);
  process.exitCode = 1;
}
if (rejoin && rejoin.failures > 0) {
  console.error(`\n${String(rejoin.failures)} clients did not rejoin.`);
  process.exitCode = 1;
}
