import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { decide, GATE_RULE, median } from "./decide.ts";
import { REFERENCE } from "./reference.ts";

/**
 * The engine performance gate (docs/performance.md). Plays the reference game
 * on this checkout and, with --base, on another checkout of the repository,
 * alternating between them in fresh processes, and fails when this one is
 * slower by the rule in decide.ts or when its tick p95 is over --budget.
 */
const { values } = parseArgs({
  // `bun run perf:engine -- --base dir` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    // A checkout of the commit to compare with, such as a git worktree of the merge base.
    base: { type: "string" },
    "base-label": { type: "string" },
    budget: { type: "string", default: "30" },
    ticks: { type: "string", default: String(REFERENCE.ticks) },
    // Runs of this checkout when there is no base to compare with.
    runs: { type: "string", default: "3" },
    // Makes this checkout's ticks that much slower, in percent, to check the gate itself.
    slowdown: { type: "string", default: "0" },
    json: { type: "string" },
    // A slowdown accepted in review: reported, but it does not fail the gate. The budget still does.
    accept: { type: "string" },
  },
});

interface Run {
  readonly robust: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly ticks: number;
  readonly alive: number;
  readonly cities: number;
  readonly forts: number;
  readonly hash: number;
}

const child = fileURLToPath(new URL("child.ts", import.meta.url));

function play(engine: string | undefined, slowdown: string): Run {
  const args = [
    "--import",
    "tsx",
    "--expose-gc",
    child,
    "--ticks",
    values.ticks,
    "--slowdown",
    slowdown,
  ];
  if (engine !== undefined) args.push("--engine", engine);
  const output = execFileSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output.trim().split("\n").at(-1) ?? "") as Run;
}

const ms = (value: number): string => `${value.toFixed(2)} ms`;
const budget = Number(values.budget);
const head: Run[] = [];
const base: Run[] = [];
const ratios: number[] = [];
let note = "";
let verdict: ReturnType<typeof decide> | undefined;

const playHead = (): Run => play(undefined, values.slowdown);

if (values.base === undefined) {
  for (let i = 0; i < Number(values.runs); i++) head.push(playHead());
} else {
  const baseDir = values.base;
  let comparable = true;
  try {
    // A warm-up run, not counted: the first processes fill the disk cache and tsx's.
    play(baseDir, "0");
  } catch (error) {
    // An older engine the reference game cannot drive: keep the absolute budget only.
    // Only this first run may fail that way; a later failure fails the gate.
    comparable = false;
    note = `The base could not run the reference game, so it was not compared: ${String(error).split("\n")[0] ?? ""}`;
    head.push(playHead());
  }
  if (comparable) {
    playHead();
    for (;;) {
      // ABBA: which side goes first alternates, so a drift of the machine favours neither.
      const baseFirst = ratios.length % 2 === 0;
      const early = baseFirst ? play(baseDir, "0") : undefined;
      const h = playHead();
      const b = early ?? play(baseDir, "0");
      base.push(b);
      head.push(h);
      ratios.push(h.robust / b.robust);
      console.log(
        `round ${String(ratios.length)}: base ${ms(b.robust)}, head ${ms(h.robust)}, ratio ${(h.robust / b.robust).toFixed(3)}`,
      );
      // A verdict after the first rounds, and if they were not clear, after the extra ones.
      if (
        ratios.length !== GATE_RULE.firstRounds &&
        ratios.length !== GATE_RULE.firstRounds + GATE_RULE.extraRounds
      )
        continue;
      verdict = decide(ratios);
      if (verdict.outcome !== "more") break;
    }
  }
}

const p95 = median(head.map((r) => r.p95));
const overBudget = p95 > budget;
const last = head.at(-1) as Run;
const workloadChanged = base.length > 0 && base[0]?.hash !== last.hash;

const lines: string[] = [];
lines.push(`### Engine: ${String(REFERENCE.players)} bots on World, ${String(last.ticks)} ticks`);
lines.push("");
lines.push(
  `Runner: ${cpus()[0]?.model ?? "unknown CPU"}, ${String(cpus().length)} threads, Node ${process.version}.`,
);
lines.push("");
lines.push(
  "| Engine | Runs | Tick mean (≤ p99) | Tick p50 | Tick p95 | Tick max | Alive | Cities | Forts | State hash |",
);
lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
const row = (label: string, runs: readonly Run[]) => {
  const r = runs.at(-1) as Run;
  lines.push(
    `| ${label} | ${String(runs.length)} | ${ms(median(runs.map((x) => x.robust)))} | ${ms(median(runs.map((x) => x.p50)))} | ${ms(median(runs.map((x) => x.p95)))} | ${ms(median(runs.map((x) => x.max)))} | ${String(r.alive)} | ${String(r.cities)} | ${String(r.forts)} | ${r.hash.toString(16).padStart(8, "0")} |`,
  );
};
row("this commit", head);
if (base.length > 0) row(`base ${values["base-label"] ?? ""}`.trim(), base);
lines.push("");
lines.push(`Tick p95 ${ms(p95)}, budget ${ms(budget)}: ${overBudget ? "**over**" : "within"}.`);
if (verdict) {
  lines.push("");
  lines.push(
    `Compared with the base: ${verdict.outcome === "fail" ? "**slower**" : "not slower"} (${verdict.reason}). ` +
      `Ratios: ${ratios.map((r) => r.toFixed(3)).join(", ")}.`,
  );
  if (workloadChanged) {
    lines.push("");
    lines.push(
      "The two engines reached different states: the rules or the bots changed, so they did not play the same game.",
    );
  }
}
if (verdict?.outcome === "fail" && values.accept !== undefined) {
  lines.push("", `The slowdown was accepted in review: ${values.accept}`);
}
if (note) lines.push("", note);
if (values.slowdown !== "0")
  lines.push("", `Self-test: this commit was slowed down by ${values.slowdown} %.`);
lines.push("");
const report = lines.join("\n");
console.log(`\n${report}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (values.json) {
  writeFileSync(values.json, JSON.stringify({ head, base, ratios, verdict, p95, budget }, null, 2));
}

let failed = false;
if (overBudget) {
  console.error(`tick p95 ${ms(p95)} is over the ${ms(budget)} budget`);
  failed = true;
}
if (verdict?.outcome === "fail") {
  if (values.accept === undefined) {
    console.error(`the engine is slower than the base: ${verdict.reason}`);
    failed = true;
  } else {
    const message = `the engine is slower than the base, accepted: ${values.accept}`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
  }
}
process.exit(failed ? 1 : 0);
