import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { Doctrine, type BotDifficulty } from "@frontfall/engine";
import type { BalanceSetup, GameReport } from "./game.ts";

/**
 * `pnpm balance:doctrines`: plays the same human-like player once per
 * doctrine in every game, the doctrines dealt to the seats in turn so that
 * each one holds each seat equally often, and prints how often each doctrine
 * wins and how much land it holds against its fair share (R-DOCTRINE-06).
 * The guardrail of #118: no doctrine above 1.5 times its fair share.
 *
 *   pnpm balance:doctrines -- --map world --nations normal --seeds 1-60
 *   pnpm balance:doctrines -- --map world --nations normal --seeds 1-1000 --jobs 8 --control
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    map: { type: "string", default: "world" },
    // The map's nations play, at this difficulty; none when left out.
    nations: { type: "string" },
    cities: { type: "string", default: "0" },
    seeds: { type: "string", default: "1-60" },
    minutes: { type: "string", default: "30" },
    jobs: { type: "string", default: String(availableParallelism()) },
    // A fourth player with no doctrine, the reference the three are weighed against.
    control: { type: "boolean", default: false },
    json: { type: "string" },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};
const nations: BotDifficulty | undefined =
  values.nations === undefined
    ? undefined
    : values.nations === "easy" || values.nations === "normal" || values.nations === "hard"
      ? values.nations
      : fail(`unknown difficulty ${values.nations}`);

const seeds = values.seeds.split(",").flatMap((part) => {
  const [from = "", to = from] = part.split("-");
  const out: number[] = [];
  for (let s = Number(from); s <= Number(to); s++) out.push(s);
  return out;
});

const NAMES = ["balanced", "conqueror", "merchant", "bastion"] as const;
const PICKS = [Doctrine.Conqueror, Doctrine.Merchant, Doctrine.Bastion];

/** The doctrines in seat order for a seed: every order of the three comes round, the control last. */
function seats(seed: number): number[] {
  const orders = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
    [1, 0, 2],
    [0, 2, 1],
  ] as const;
  const order = orders[seed % orders.length] as readonly number[];
  const picked = order.map((i) => PICKS[i] as number);
  return values.control ? [...picked, Doctrine.Balanced] : picked;
}

const setups: BalanceSetup[] = seeds.map((seed) => ({
  map: values.map,
  seed,
  bots: [],
  ...(nations ? { nations } : {}),
  ...(Number(values.cities) > 0 ? { cityStates: Number(values.cities) } : {}),
  doctrineHumans: seats(seed),
  minutes: Number(values.minutes),
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
    reports.push(await play(setup));
    if (reports.length % 10 === 0) console.error(`${String(reports.length)} games played`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(values.jobs)) }, worker));
reports.sort((a, b) => a.setup.seed - b.setup.seed);

interface Tally {
  games: number;
  wins: number;
  share: number;
  eliminated: number;
}
const tallies = new Map<number, Tally>();
const tally = (doctrine: number): Tally => {
  let t = tallies.get(doctrine);
  if (!t) tallies.set(doctrine, (t = { games: 0, wins: 0, share: 0, eliminated: 0 }));
  return t;
};
let humanWins = 0;
for (const report of reports) {
  const humans = report.players.filter((p) => p.kind === "human");
  const land = humans.reduce((sum, p) => sum + p.tiles, 0);
  for (const p of humans) {
    const t = tally(p.doctrine ?? 0);
    t.games++;
    t.share += land === 0 ? 0 : p.tiles / land;
    if (p.eliminatedAt !== undefined) t.eliminated++;
    if (report.winner === p.id) {
      t.wins++;
      humanWins++;
    }
  }
}

const seatsPerGame = values.control ? 4 : 3;
const rows = [...tallies.entries()]
  .sort(([a], [b]) => a - b)
  .map(([doctrine, t]) => ({
    doctrine: NAMES[doctrine] ?? String(doctrine),
    games: t.games,
    wins: t.wins,
    // Of the games a human won: the doctrine's wins against the fair share, 1 being fair.
    winFairness: humanWins === 0 ? 0 : (t.wins * seatsPerGame) / humanWins,
    // Of the land the humans hold at the end: the doctrine's share against the fair share.
    landFairness: (t.share / Math.max(1, t.games)) * seatsPerGame,
    eliminated: t.eliminated,
  }));

console.log(
  `\n${values.map}, ${String(reports.length)} games of ${String(seatsPerGame)} human-like players` +
    `${nations ? `, nations ${nations}` : ""}${values.control ? ", control without doctrine" : ""}`,
);
console.log(`games a human won: ${String(humanWins)} of ${String(reports.length)}`);
console.log("\nfairness against a fair share (1 is fair; the guardrail is 1.5):");
console.table(
  rows.map((r) => ({
    ...r,
    winFairness: r.winFairness.toFixed(2),
    landFairness: r.landFairness.toFixed(2),
  })),
);
const picked = rows.filter((r) => r.doctrine !== "balanced");
const worst = Math.max(...picked.map((r) => r.landFairness));
// Wins only count once enough games were won: a handful of wins says nothing.
const winsCount = humanWins >= 10 * seatsPerGame;
const bestWins = Math.max(...picked.map((r) => r.winFairness));
const verdict =
  worst <= 1.5 && (!winsCount || bestWins <= 1.5) ? "within the guardrail" : "OVER THE GUARDRAIL";
console.log(
  `highest land fairness ${worst.toFixed(2)}, highest win fairness ${bestWins.toFixed(2)}${winsCount ? "" : " (too few wins to count)"}: ${verdict}`,
);
console.log(
  `\n${String(reports.length)} games in ${((performance.now() - began) / 1000).toFixed(0)} s`,
);
if (values.json) writeFileSync(values.json, `${JSON.stringify({ rows, reports })}\n`);
if (verdict !== "within the guardrail") process.exitCode = 1;
