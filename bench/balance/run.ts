import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { DEFAULT_BALANCE, type Balance, type BotDifficulty } from "@frontfall/engine";
import type { BalanceSetup, GameReport } from "./game.ts";
import { summarize, type BalanceSummary } from "./summary.ts";

/**
 * `pnpm balance`: plays the same setup on many seeds, bots and nations only,
 * several games at a time, and prints what balance.md is tuned on: how long
 * a game lasts, who wins against their fair share, income from troops and
 * from trade, and missiles. Every game is deterministic, so a run gives the
 * same figures on any machine.
 *
 *   pnpm balance -- --map world --bots normal:8 --seeds 1-8
 *   pnpm balance -- --map world --bots normal:4,hard:4 --nations normal --casual
 *   pnpm balance -- --map world --bots normal:0 --nations hard --average
 *   pnpm balance -- --map europe --bots hard:11 --set tradeBase=4000 --json out.json
 *   pnpm balance -- --map world --bots normal:0 --nations normal --average --rule collapsingFronts
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    map: { type: "string", default: "world" },
    // Groups of bots as difficulty:count, separated by commas.
    bots: { type: "string", default: "normal:8" },
    // The map's nations play, at this difficulty.
    nations: { type: "string" },
    teams: { type: "string" },
    casual: { type: "boolean", default: false },
    // The stronger scripted player, in place of the casual one.
    average: { type: "boolean", default: false },
    seeds: { type: "string", default: "1-8" },
    minutes: { type: "string", default: "20" },
    jobs: { type: "string", default: String(availableParallelism()) },
    // A balance value to try, as a field of Balance: --set tradeBase=4000.
    set: { type: "string", multiple: true, default: [] },
    // Special rules to play with (R-MODE-08), by name: --rule collapsingFronts.
    rule: { type: "string", multiple: true, default: [] },
    json: { type: "string" },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};
const difficulty = (name: string): BotDifficulty =>
  name === "easy" || name === "normal" || name === "hard"
    ? name
    : fail(`unknown difficulty ${name}`);

const bots = values.bots
  .split(",")
  .filter(Boolean)
  .map((group) => {
    const [name = "", count = ""] = group.split(":");
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) fail(`--bots wants difficulty:count, not ${group}`);
    return { difficulty: difficulty(name), count: n };
  });

const seeds = values.seeds.split(",").flatMap((part) => {
  const [from = "", to = from] = part.split("-");
  const out: number[] = [];
  for (let s = Number(from); s <= Number(to); s++) out.push(s);
  return out;
});

const balance: Record<string, number> = {};
for (const pair of values.set) {
  const [key = "", value = ""] = pair.split("=");
  if (!(key in DEFAULT_BALANCE) || typeof DEFAULT_BALANCE[key as keyof Balance] !== "number") {
    fail(`--set: ${key} is not a numeric balance value`);
  }
  balance[key] = Number(value);
}

const setups: BalanceSetup[] = seeds.map((seed) => ({
  map: values.map,
  seed,
  bots,
  ...(values.nations ? { nations: difficulty(values.nations) } : {}),
  ...(values.teams ? { teams: Number(values.teams) } : {}),
  ...(values.casual ? { casual: true } : {}),
  ...(values.average ? { average: true } : {}),
  minutes: Number(values.minutes),
  ...(values.set.length ? { balance: balance } : {}),
  ...(values.rule.length ? { rules: Object.fromEntries(values.rule.map((r) => [r, true])) } : {}),
}));

const run = promisify(execFile);
const child = fileURLToPath(new URL("child.ts", import.meta.url));

async function play(setup: BalanceSetup): Promise<GameReport> {
  const { stdout } = await run(
    process.execPath,
    ["--import", "tsx", child, JSON.stringify(setup)],
    {
      maxBuffer: 64 << 20,
    },
  );
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as GameReport;
}

const began = performance.now();
const reports: GameReport[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < setups.length) {
    const setup = setups[next++] as BalanceSetup;
    const report = await play(setup);
    reports.push(report);
    const winner = report.players.find((p) => p.id === report.winner);
    console.error(
      `seed ${String(setup.seed)}: ` +
        (report.decidedAt === undefined
          ? `undecided after ${String(setup.minutes)} min`
          : `${winner?.name ?? "?"} (${winner?.kind ?? "?"}) in ${report.decidedAt.toFixed(1)} min`) +
        `, ${(report.ms / 1000).toFixed(0)} s`,
    );
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(values.jobs)) }, worker));
reports.sort((a, b) => a.setup.seed - b.setup.seed);
const summary = summarize(reports);
print(summary);
console.log(
  `\n${String(reports.length)} games in ${((performance.now() - began) / 1000).toFixed(0)} s`,
);
if (values.json) writeFileSync(values.json, `${JSON.stringify({ summary, reports })}\n`);

function print(s: BalanceSummary): void {
  const round = (value: number, digits = 1): string => value.toFixed(digits);
  console.log(
    `\n${values.map}, bots ${values.bots}${values.nations ? `, nations ${values.nations}` : ""}` +
      `${values.teams ? `, ${values.teams} teams` : ""}${values.average ? ", average player" : values.casual ? ", casual player" : ""}` +
      (values.set.length ? `, ${values.set.join(" ")}` : "") +
      (values.rule.length ? `, rules ${values.rule.join(" ")}` : ""),
  );
  console.log(
    `decided: ${String(s.decided)} of ${String(s.games)}` +
      (s.decidedAt
        ? `, in ${round(s.decidedAt.median)} min (median), ${round(s.decidedAt.min)} to ${round(s.decidedAt.max)}`
        : ""),
  );
  console.log("\nwins against fair share (1 is fair, over 2 runs away):");
  console.table(
    s.groups.map((g) => ({
      group: g.group,
      players: g.players,
      wins: g.wins,
      fairness: round(g.fairness, 2),
    })),
  );
  console.log("leader's share of the land, median, %:");
  console.table([
    Object.fromEntries(Object.entries(s.leaderShare).map(([m, v]) => [`${m} min`, round(v)])),
  ]);
  console.log("gold per second, medians (median player, leader; trade: players with a port):");
  console.table(
    s.income.map((i) => ({
      minute: i.minute,
      "troops (median)": Math.round(i.medianTroop),
      "trade (median)": Math.round(i.medianTrade),
      "troops (leader)": Math.round(i.leaderTroop),
      "trade (leader)": Math.round(i.leaderTrade),
    })),
  );
  const m = s.missiles;
  console.log(
    `missiles per game: ${String(m.median)} median, ${String(m.max)} at most; ` +
      `${round(m.atLeaderPercent, 0)} % at the leader; at most ${String(m.perMinuteMax)} in a minute, ${String(m.burstMax)} in 10 s`,
  );
  if (s.casual) {
    console.log(
      `${values.average ? "average" : "casual"} player: won ${String(s.casual.won)}, alive at the end ${String(s.casual.alive)}` +
        (s.casual.eliminatedMedian === undefined
          ? ""
          : `, eliminated after ${round(s.casual.eliminatedMedian)} min (median)`),
    );
  }
}
