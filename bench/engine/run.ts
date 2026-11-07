import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { parseArgs } from "node:util";
import { scenarios } from "./scenarios.ts";
import { summarize, type Summary } from "./stats.ts";
import { ExpansionWorkload } from "./workload.ts";

/** Budget for the whole simulation step at 10 ticks per second. */
const TICK_BUDGET_MS = 30;

const { values } = parseArgs({
  // `bun run bench -- --quick` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    scenario: { type: "string", multiple: true },
    quick: { type: "boolean", default: false },
    json: { type: "string" },
  },
});

const selected = values.scenario ?? scenarios.map((s) => s.name);
const unknown = selected.filter((name) => !scenarios.some((s) => s.name === name));
if (unknown.length > 0) {
  console.error(`Unknown scenario: ${unknown.join(", ")}`);
  process.exit(2);
}

const collect = (): void => {
  (globalThis as { gc?: () => void }).gc?.();
};
const mib = (bytes: number): string => (bytes / 2 ** 20).toFixed(1);
const ms = (value: number): string => value.toFixed(2);

interface Result {
  readonly name: string;
  readonly map: string;
  readonly players: number;
  readonly capturesPerTick: number;
  readonly setupMs: number;
  readonly tick: Summary;
  readonly capturedPerTick: number;
  readonly fullRescanMs: number;
  readonly engineBytes: number;
  readonly arrayBufferBytes: number;
  readonly heapBytes: number;
  readonly digest: string;
  readonly withinBudget: boolean;
}

/**
 * What the incremental border lists save: the time a naive tick would spend
 * rescanning every tile to find the front lines.
 */
function fullBorderRescanMs(workload: ExpansionWorkload): number {
  const { grid, territory } = workload;
  const owners = territory.owners;
  const around = new Int32Array(4);
  const start = performance.now();
  let borders = 0;
  for (let tile = 0; tile < grid.size; tile++) {
    const owner = owners[tile];
    if (owner === 0) continue;
    const count = grid.neighborsInto(tile, around);
    for (let i = 0; i < count; i++) {
      if (owners[around[i] as number] !== owner) {
        borders++;
        break;
      }
    }
  }
  const elapsed = performance.now() - start;
  // Keeps the loop observable so it cannot be optimised away.
  if (borders === -1) console.log(borders);
  return elapsed;
}

const results: Result[] = [];
console.log(
  `Node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"}, ${mib(totalmem())} MiB`,
);

for (const scenario of scenarios.filter((s) => selected.includes(s.name))) {
  const warmup = values.quick ? Math.ceil(scenario.warmupTicks / 10) : scenario.warmupTicks;
  const measured = values.quick ? Math.ceil(scenario.measuredTicks / 10) : scenario.measuredTicks;

  collect();
  const baseline = process.memoryUsage();
  const setupStart = performance.now();
  const workload = new ExpansionWorkload(scenario.workload);
  const setupMs = performance.now() - setupStart;

  for (let i = 0; i < warmup; i++) workload.tick();
  collect();

  const samples: number[] = [];
  let captured = 0;
  for (let i = 0; i < measured; i++) {
    const start = performance.now();
    const result = workload.tick();
    samples.push(performance.now() - start);
    captured += result.captured + result.annexed;
    workload.territory.clearChanges();
  }

  collect();
  const memory = process.memoryUsage();
  const tick = summarize(samples);
  const { width, height, players, capturesPerTick } = scenario.workload;
  results.push({
    name: scenario.name,
    map: `${String(width)}x${String(height)}`,
    players,
    capturesPerTick,
    setupMs,
    tick,
    capturedPerTick: Math.round(captured / measured),
    fullRescanMs: fullBorderRescanMs(workload),
    engineBytes: workload.memoryBytes(),
    arrayBufferBytes: memory.arrayBuffers - baseline.arrayBuffers,
    heapBytes: memory.heapUsed - baseline.heapUsed,
    digest: workload.digest().toString(16).padStart(8, "0"),
    withinBudget: tick.p95 <= TICK_BUDGET_MS,
  });
}

console.log();
console.log(
  "| Scenario | Map | Players | Changes/tick | Tick p50 | Tick p95 | Tick max | Full rescan | Engine memory | Digest |",
);
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
for (const r of results) {
  const flag = r.withinBudget ? "" : " ⚠";
  console.log(
    `| ${r.name} | ${r.map} | ${String(r.players)} | ${String(r.capturedPerTick)} | ${ms(r.tick.p50)} ms | ${ms(r.tick.p95)} ms${flag} | ${ms(r.tick.max)} ms | ${ms(r.fullRescanMs)} ms | ${mib(r.engineBytes)} MiB | ${r.digest} |`,
  );
}
console.log(`\nBudget: tick p95 <= ${String(TICK_BUDGET_MS)} ms.`);

if (values.json) {
  writeFileSync(values.json, `${JSON.stringify({ node: process.version, results }, null, 2)}\n`);
}
if (results.some((r) => !r.withinBudget)) process.exitCode = 1;
