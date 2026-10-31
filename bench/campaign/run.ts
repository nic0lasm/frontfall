import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import type { BotDifficulty } from "@frontfall/engine";
import type { CampaignReport, CampaignSetup } from "./game.ts";
import type { ProfileName } from "./profiles.ts";
import { FUN, PERF, SKILL_GAP_POINTS, SURVIVAL_EASY_MIN, WIN_TARGETS } from "./targets.ts";

/**
 * `pnpm campaign`: every profile at every difficulty on the same seeds, then a
 * verdict against targets.ts. Exit code 1 when a target is missed or a rule broken.
 *
 *   pnpm campaign -- --map world --seeds 1-12 --minutes 30
 *   pnpm campaign -- --profiles nico --difficulties easy,normal --rule capitals
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    map: { type: "string", default: "world" },
    profiles: { type: "string", default: "beginner,nico,veteran" },
    difficulties: { type: "string", default: "easy,normal,hard" },
    seeds: { type: "string", default: "1-12" },
    minutes: { type: "string", default: "30" },
    jobs: { type: "string", default: String(availableParallelism()) },
    rule: { type: "string", multiple: true, default: [] },
    json: { type: "string" },
  },
});

const seeds = values.seeds.split(",").flatMap((part) => {
  const [from = "", to = from] = part.split("-");
  const out: number[] = [];
  for (let s = Number(from); s <= Number(to); s++) out.push(s);
  return out;
});
const profiles = values.profiles.split(",") as ProfileName[];
const difficulties = values.difficulties.split(",") as BotDifficulty[];
const rules = Object.fromEntries(values.rule.map((r) => [r, true]));

const setups: CampaignSetup[] = [];
for (const profile of profiles)
  for (const difficulty of difficulties)
    for (const seed of seeds)
      setups.push({
        map: values.map,
        seed,
        profile,
        difficulty,
        minutes: Number(values.minutes),
        ...(values.rule.length ? { rules } : {}),
      });

const run = promisify(execFile);
const child = fileURLToPath(new URL("child.ts", import.meta.url));
const reports: CampaignReport[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < setups.length) {
    const setup = setups[next++] as CampaignSetup;
    try {
      const { stdout } = await run(
        process.execPath,
        ["--import", "tsx", child, JSON.stringify(setup)],
        {
          maxBuffer: 64 << 20,
        },
      );
      reports.push(JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as CampaignReport);
    } catch (error) {
      console.error(`CRASH ${JSON.stringify(setup)}: ${String(error).slice(0, 300)}`);
      process.exitCode = 1;
    }
  }
}
const began = performance.now();
await Promise.all(Array.from({ length: Math.max(1, Number(values.jobs)) }, worker));

const pct = (n: number, d: number): number => (d === 0 ? 0 : (n * 100) / d);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const verdicts: string[] = [];
const rows: Record<string, string | number>[] = [];
const winRate: Record<string, number> = {};
for (const profile of profiles) {
  for (const difficulty of difficulties) {
    const rs = reports.filter(
      (r) => r.setup.profile === profile && r.setup.difficulty === difficulty,
    );
    if (rs.length === 0) continue;
    const win = pct(rs.filter((r) => r.won).length, rs.length);
    winRate[`${profile}/${difficulty}`] = win;
    const [lo, hi] = WIN_TARGETS[profile][difficulty];
    const ok = win >= lo && win <= hi;
    if (!ok)
      verdicts.push(
        `${profile}/${difficulty}: wins ${win.toFixed(0)} %, target ${String(lo)}-${String(hi)} %`,
      );
    const survive = pct(rs.filter((r) => r.aliveAtEnd).length, rs.length);
    if (difficulty === "easy" && survive < SURVIVAL_EASY_MIN[profile]) {
      verdicts.push(
        `${profile}/easy: survives ${survive.toFixed(0)} %, wants ${String(SURVIVAL_EASY_MIN[profile])} %`,
      );
    }
    const dead = median(rs.map((r) => (r.deadMinutes * 100) / r.playedMinutes));
    if (profile !== "beginner" && dead > FUN.deadMinutesMaxPercent) {
      verdicts.push(
        `${profile}/${difficulty}: ${dead.toFixed(0)} % dead minutes (no land change), max ${String(FUN.deadMinutesMaxPercent)} %`,
      );
    }
    const stale = pct(rs.filter((r) => r.stalemate).length, rs.length);
    if (stale > FUN.stalemateMaxPercent)
      verdicts.push(`${profile}/${difficulty}: ${stale.toFixed(0)} % of games stall`);
    const refused = pct(
      rs.reduce((a, r) => a + r.refused, 0),
      rs.reduce((a, r) => a + r.sent, 0),
    );
    if (profile === "veteran" && refused > FUN.refusedMaxPercentVeteran) {
      verdicts.push(`${profile}/${difficulty}: ${refused.toFixed(0)} % of orders refused`);
    }
    const p99 = median(rs.map((r) => r.tickP99Ms));
    const max = Math.max(...rs.map((r) => r.tickMaxMs));
    if (p99 > PERF.tickP99MaxMs || max > PERF.tickMaxMs) {
      verdicts.push(
        `${profile}/${difficulty}: tick p99 ${p99.toFixed(1)} ms, worst ${max.toFixed(0)} ms`,
      );
    }
    for (const r of rs)
      for (const v of r.violations)
        verdicts.push(`RULE seed ${String(r.setup.seed)} ${profile}/${difficulty}: ${v}`);
    const fights = rs.flatMap((r) =>
      r.firstFightMinute === undefined ? [] : [r.firstFightMinute],
    );
    rows.push({
      profile,
      difficulty,
      games: rs.length,
      "win %": Math.round(win),
      target: `${String(lo)}-${String(hi)}`,
      ok: ok ? "yes" : "NO",
      // Information only: the campaign's criterion is the outright win.
      "won or led >40 % at end": Math.round(
        pct(rs.filter((r) => r.won || r.led).length, rs.length),
      ),
      "alive %": Math.round(survive),
      "share % (med)": Math.round(median(rs.map((r) => r.finalSharePercent))),
      "dead min %": Math.round(dead),
      "under attack %": Math.round(median(rs.map((r) => r.underAttackPercent))),
      "1st fight min": fights.length ? Math.round(median(fights)) : "-",
      "refused %": Math.round(refused),
      stalled: Math.round(stale),
      "tick p99 ms": Number(p99.toFixed(1)),
    });
  }
}
for (const difficulty of difficulties) {
  const order: ProfileName[] = ["beginner", "nico", "veteran"];
  for (let i = 1; i < order.length; i++) {
    const [lower, upper] = [order[i - 1] as ProfileName, order[i] as ProfileName];
    const a = winRate[`${lower}/${difficulty}`];
    const b = winRate[`${upper}/${difficulty}`];
    if (a !== undefined && b !== undefined && b - a < SKILL_GAP_POINTS && !(a >= 95 && b >= 95)) {
      verdicts.push(
        `${difficulty}: ${upper} (${b.toFixed(0)} %) barely beats ${lower} (${a.toFixed(0)} %): skill does not pay`,
      );
    }
  }
}
console.table(rows);
console.log(
  `\n${String(reports.length)} of ${String(setups.length)} games in ${((performance.now() - began) / 1000).toFixed(0)} s`,
);
console.log(verdicts.length ? `\nTO FIX:\n- ${verdicts.join("\n- ")}` : "\nCAMPAIGN GREEN");
if (values.json) writeFileSync(values.json, `${JSON.stringify({ rows, verdicts, reports })}\n`);
if (verdicts.length) process.exitCode = 1;
