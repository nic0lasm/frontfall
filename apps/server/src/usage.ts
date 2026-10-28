import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { UsageReport } from "@frontfall/protocol";

/**
 * Counts of what players do, from the reports their pages send
 * (docs/privacy.md). A report only ever adds one to a few counters and is
 * then forgotten: the counts are all the server keeps, per day and in total.
 */

/** Counts by dimension, then by value: `{ map: { world: 12 } }`. */
export type Tally = Record<string, Record<string, number>>;

/** Days kept in the export, counted back from today. */
const KEEP_DAYS = 90;

/** How long a game's id is remembered, so that a second report of it counts for nothing. */
const SEEN_MS = 2 * 60 * 60 * 1000;
/** Ids remembered at most; past this the oldest go first. */
const MAX_SEEN = 50_000;

/** Names of the `Disable` bits of the engine, in bit order (R-MODE-03). */
const DISABLED_NAMES = ["city", "fort", "port", "silo", "air_defense", "warships"];

/** The range a number falls in, named by its bounds: `[1, 6, 21]` gives 0, 1-5, 6-20, 21+. */
function range(value: number, starts: readonly number[]): string {
  let label = String(value);
  for (let index = starts.length - 1; index >= 0; index--) {
    const start = starts[index] ?? 0;
    if (value < start) continue;
    const next = starts[index + 1];
    label =
      next === undefined
        ? `${String(start)}+`
        : next - 1 === start
          ? String(start)
          : `${String(start)}-${String(next - 1)}`;
    break;
  }
  return label;
}

/** Minutes played, in ranges that tell a quick look from a whole game. */
export function minutesRange(minutes: number): string {
  const bounds = [2, 5, 10, 20, 40];
  const upper = bounds.findIndex((bound) => minutes < bound);
  if (upper === 0) return "0-2";
  if (upper < 0) return "40+";
  return `${String(bounds[upper - 1])}-${String(bounds[upper])}`;
}

/** Seconds before a player's first order, in ranges; `none` for a game with no order. */
export function firstOrderRange(seconds: number | undefined): string {
  if (seconds === undefined) return "none";
  const bounds = [10, 30, 60, 120];
  const upper = bounds.findIndex((bound) => seconds < bound);
  if (upper === 0) return "0-10";
  if (upper < 0) return "120+";
  return `${String(bounds[upper - 1])}-${String(bounds[upper])}`;
}

export const botsRange = (bots: number): string => range(bots, [0, 1, 6, 21, 51]);
export const humansRange = (humans: number): string => range(humans, [1, 2, 3, 5, 9]);

const StoredTally = z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()));
const Stored = z.object({
  version: z.literal(1),
  total: StoredTally,
  days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), StoredTally),
});
type Stored = z.infer<typeof Stored>;

/** What /api/stats returns. */
export interface UsageExport {
  release: string;
  /** First day counted. */
  since: string | null;
  total: Tally;
  /** Newest first. */
  days: { day: string; counts: Tally }[];
}

export interface UsageOptions {
  /** Release of the server: reports from pages of another one count as `other`. */
  release: string;
  /** Ids of the published maps; any other map counts as `other`. */
  maps: ReadonlySet<string>;
}

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function add(tally: Tally, dimension: string, value: string): void {
  const values = (tally[dimension] ??= {});
  values[value] = (values[value] ?? 0) + 1;
}

export class UsageStats {
  private total: Tally = {};
  private readonly days = new Map<string, Tally>();
  /** Ids of games already reported, and of games already voted on, until when. */
  private readonly seen = new Map<string, number>();

  constructor(private readonly options: UsageOptions) {}

  /** Counts a report; false when it repeats one already counted. */
  record(report: UsageReport, now: number): boolean {
    if (report.kind !== "error") {
      const key = `${report.kind}:${report.game}`;
      this.forget(now);
      if ((this.seen.get(key) ?? 0) > now) return false;
      this.seen.set(key, now + SEEN_MS);
    }
    const counts: [string, string][] = [];
    const release = report.release === this.options.release ? report.release : "other";
    if (report.kind === "game") {
      const map =
        report.map === "generated" || this.options.maps.has(report.map) ? report.map : "other";
      counts.push(
        ["games", report.mode],
        ["outcome", `${report.mode}.${report.outcome}`],
        ["map", map],
        ["teams", String(report.teams)],
        ["nations", report.nations ? "on" : "off"],
        ["bots", botsRange(report.bots)],
        ["humans", humansRange(report.humans)],
        ["difficulty", report.difficulty],
        ["minutes", minutesRange(report.minutes)],
        ["first_order", firstOrderRange(report.firstOrder)],
        ["device", report.device],
        ["touch", report.touch ? "yes" : "no"],
        ["lang", report.lang],
        ["view", report.view],
        ["release", release],
      );
      // Who leaves at once and who is beaten at once, apart: the funnel of first games.
      if (report.minutes < 2) counts.push(["early", `${report.mode}.${report.outcome}`]);
      DISABLED_NAMES.forEach((name, bit) => {
        if (report.disabled & (1 << bit)) counts.push(["disabled", name]);
      });
      for (const [rule, on] of Object.entries(report.rules ?? {})) {
        if (on) counts.push(["rules", rule]);
      }
    } else if (report.kind === "error") {
      counts.push(["errors", report.type]);
    } else {
      counts.push(
        ["votes", report.vote],
        ["votes_by", `${report.mode}.${report.outcome}.${report.vote}`],
      );
      if (report.reason) counts.push(["reasons", report.reason]);
    }
    const day = this.day(now);
    for (const [dimension, value] of counts) {
      add(this.total, dimension, value);
      add(day, dimension, value);
    }
    return true;
  }

  export(now: number): UsageExport {
    this.prune(now);
    const days = [...this.days.keys()].sort().reverse();
    return {
      release: this.options.release,
      since: days.at(-1) ?? null,
      total: this.total,
      days: days.map((day) => ({ day, counts: this.days.get(day) ?? {} })),
    };
  }

  /** The totals as one Prometheus counter, labelled by dimension and value. */
  renderMetrics(): string[] {
    const lines = [
      "# HELP frontfall_usage_total Reports of players' pages, counted by dimension and value.",
      "# TYPE frontfall_usage_total counter",
    ];
    for (const [dimension, values] of Object.entries(this.total)) {
      for (const [value, count] of Object.entries(values)) {
        lines.push(
          `frontfall_usage_total{dimension="${dimension}",value="${value}"} ${String(count)}`,
        );
      }
    }
    return lines;
  }

  /** The counts as written to disk. */
  serialize(now: number): string {
    this.prune(now);
    const stored: Stored = { version: 1, total: this.total, days: Object.fromEntries(this.days) };
    return JSON.stringify(stored);
  }

  /** Takes back counts written by serialize(); false when the text is not such counts. */
  restore(text: string): boolean {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }
    const parsed = Stored.safeParse(raw);
    if (!parsed.success) return false;
    this.total = parsed.data.total;
    this.days.clear();
    for (const [day, tally] of Object.entries(parsed.data.days)) this.days.set(day, tally);
    return true;
  }

  /** The days counted, grouped by month (`2026-10`), oldest first. */
  months(now: number): Map<string, Map<string, Tally>> {
    this.prune(now);
    const months = new Map<string, Map<string, Tally>>();
    for (const day of [...this.days.keys()].sort()) {
      const month = day.slice(0, 7);
      const inMonth = months.get(month) ?? new Map<string, Tally>();
      inMonth.set(day, this.days.get(day) ?? {});
      months.set(month, inMonth);
    }
    return months;
  }

  private day(now: number): Tally {
    const key = dayOf(now);
    let tally = this.days.get(key);
    if (!tally) {
      tally = {};
      this.days.set(key, tally);
      this.prune(now);
    }
    return tally;
  }

  private prune(now: number): void {
    const oldest = dayOf(now - (KEEP_DAYS - 1) * 24 * 60 * 60 * 1000);
    for (const day of this.days.keys()) if (day < oldest) this.days.delete(day);
  }

  private forget(now: number): void {
    for (const [key, until] of this.seen) {
      if (until > now && this.seen.size <= MAX_SEEN) break;
      this.seen.delete(key);
    }
  }
}

/** Where the counts are kept between restarts, inside the server's data directory. */
export function usageFile(dataDir: string): string {
  return join(dataDir, "usage", "usage.json");
}

/** Reads the counts kept by an earlier run, or the copy made before the last save. */
export function loadUsage(stats: UsageStats, file: string): Error | undefined {
  // A missing file beside a copy was lost, not never written; starting empty
  // would let the second save write the empty counts over that copy.
  const error =
    existsSync(file) || !existsSync(`${file}.bak`)
      ? loadUsageFile(stats, file)
      : new Error(`${file} is missing`);
  if (error === undefined) return undefined;
  if (!existsSync(`${file}.bak`)) return error;
  // The copy stands in for the damaged file; the error still says what happened to it.
  const backup = loadUsageFile(stats, `${file}.bak`);
  return backup === undefined
    ? new Error(`${error.message}; went on with the copy made before the last save`)
    : new Error(`${error.message}; the copy did not read either: ${backup.message}`);
}

/** Reads one file of counts; an error says why they could not be read. */
function loadUsageFile(stats: UsageStats, file: string): Error | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    // A first start has nothing to read.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return error as Error;
  }
  if (stats.restore(text)) return undefined;
  // Kept aside rather than overwritten by the next save, so the counts can be mended by hand.
  try {
    renameSync(file, `${file}.broken`);
  } catch {
    // Left in place: the next save replaces it.
  }
  return new Error(`unreadable usage counts, kept as ${file}.broken`);
}

/** Writes a file readable by the server's user only, replacing the old one at once. */
function writePrivate(file: string, text: string): void {
  const temporary = `${file}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Writes the counts readable by the server's user only, replacing the old file at once. */
export function saveUsage(stats: UsageStats, file: string, now: number): void {
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  const text = stats.serialize(now);
  try {
    // The last good counts stay beside the new ones; a file that does not read is not kept over them.
    const before = readFileSync(file, "utf8");
    if (Stored.safeParse(JSON.parse(before)).success) writePrivate(`${file}.bak`, before);
  } catch {
    // A first save has nothing to copy, and a damaged file is not worth a copy.
  }
  writePrivate(file, text);
}

/** Where the months are exported, beside the counts: `usage/months/2026-10.json`. */
export function monthsDirectory(file: string): string {
  return join(file, "..", "months");
}

const MonthFile = z.object({
  version: z.literal(1),
  month: z.string(),
  days: z.record(z.string(), StoredTally),
});

/** The larger of two tallies of one day, dimension by dimension and value by value. */
function mostOf(a: Tally, b: Tally): Tally {
  const merged: Tally = {};
  for (const dimension of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const values: Record<string, number> = {};
    for (const value of new Set([
      ...Object.keys(a[dimension] ?? {}),
      ...Object.keys(b[dimension] ?? {}),
    ])) {
      values[value] = Math.max(a[dimension]?.[value] ?? 0, b[dimension]?.[value] ?? 0);
    }
    merged[dimension] = values;
  }
  return merged;
}

/**
 * Writes one file per month with the counts of each day, for the months
 * that changed: `{ version: 1, month, days: { "2026-10-25": tally } }`.
 * A file is added to, never cut down: days that left the 90 kept in memory
 * stay, and a day counts the larger of the file's figures and the memory's,
 * so a restart that lost counts does not lower them. A file that cannot be
 * read is set aside as `<file>.broken-<time>` and reported to `problem`.
 */
export function exportMonths(
  stats: UsageStats,
  directory: string,
  now: number,
  problem: (message: string) => void = () => undefined,
): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [month, days] of stats.months(now)) {
    const file = join(directory, `${month}.json`);
    let kept: Record<string, Tally> = {};
    let before = "";
    try {
      before = readFileSync(file, "utf8");
      kept = MonthFile.parse(JSON.parse(before)).days;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const aside = `${file}.broken-${String(now)}`;
        try {
          renameSync(file, aside);
        } catch {
          // Left in place: it is replaced below.
        }
        problem(`unreadable month ${month}, kept as ${aside}`);
      }
    }
    const merged: Record<string, Tally> = { ...kept };
    for (const [day, tally] of days) merged[day] = mostOf(kept[day] ?? {}, tally);
    const text = JSON.stringify({
      version: 1,
      month,
      days: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
    });
    if (text !== before) writePrivate(file, text);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
}

/**
 * The last days at a glance, as an HTML table for the status page: games
 * by mode, the share played on a phone or tablet, how they ended, thumbs.
 */
export function usageTable(usage: UsageExport, days = 7): string {
  const shown = usage.days.slice(0, days);
  const cell = (tally: Tally, dimension: string, value: string): number =>
    tally[dimension]?.[value] ?? 0;
  const sum = (tally: Tally, dimension: string): number =>
    Object.values(tally[dimension] ?? {}).reduce((a, b) => a + b, 0);
  const percent = (part: number, whole: number): string =>
    whole === 0 ? "–" : `${String(Math.round((100 * part) / whole))} %`;
  const ended = (tally: Tally, outcome: string): number =>
    Object.entries(tally.outcome ?? {})
      .filter(([key]) => key.endsWith(`.${outcome}`))
      .reduce((a, [, count]) => a + count, 0);
  const columns = [
    "Day / Jour",
    "Solo",
    "Public / Publique",
    "Private / Privée",
    "Phone or tablet / Mobile",
    "Won / Gagnées",
    "Left early / Quittées",
    "Thumbs up / Pouces levés",
    "Client errors / Erreurs",
  ];
  const rows = shown.map(({ day, counts }) => {
    const games = sum(counts, "games");
    const values = [
      day,
      String(cell(counts, "games", "solo")),
      String(cell(counts, "games", "public")),
      String(cell(counts, "games", "private")),
      percent(cell(counts, "device", "phone") + cell(counts, "device", "tablet"), games),
      percent(ended(counts, "victory"), games),
      percent(ended(counts, "left") + ended(counts, "closed"), games),
      percent(cell(counts, "votes", "up"), sum(counts, "votes")),
      String(sum(counts, "errors")),
    ];
    return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`;
  });
  return [
    "<h2>Last 7 days / 7 derniers jours</h2>",
    '<table class="usage">',
    `<thead><tr>${columns.map((name) => `<th scope="col">${name}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows.length > 0 ? rows.join("") : `<tr><td colspan="${String(columns.length)}">No games counted yet / Aucune partie comptée</td></tr>`}</tbody>`,
    "</table>",
    '<p><a href="api/stats">All figures, as JSON / Tous les chiffres, en JSON</a></p>',
  ].join("");
}
