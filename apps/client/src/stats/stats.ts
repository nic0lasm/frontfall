// What the statistics page draws from an /api/stats answer. No DOM here, so
// the tests run it in Node; main.ts turns it into SVG.

/** One bar of a chart: what it counts and how many. */
export interface Bar {
  label: string;
  value: number;
}

export interface Charts {
  release: string;
  /** First day counted. */
  since: string | null;
  /** Games of every mode, one bar per day, oldest first, days without a game included; 90 at most. */
  perDay: Bar[];
  /** Games by map, the most played first. */
  maps: Bar[];
  /** Games by length in minutes, the shortest range first. */
  minutes: Bar[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days the server keeps in /api/stats (KEEP_DAYS in apps/server/src/usage.ts). */
const KEEP_DAYS = 90;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The counts of one dimension, leaving out anything that is not a count. */
function dimension(tally: unknown, name: string): Bar[] {
  if (!isRecord(tally)) return [];
  const values = tally[name];
  if (!isRecord(values)) return [];
  return Object.entries(values).flatMap(([label, value]) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? [{ label, value }]
      : [],
  );
}

/** A real UTC day written YYYY-MM-DD: Date.parse alone takes February 30. */
const isDay = (text: string): boolean => {
  const time = Date.parse(text);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
};

const sum = (bars: Bar[]): number => bars.reduce((total, bar) => total + bar.value, 0);

/**
 * The charts of an /api/stats answer, parsed from its JSON. Throws an error
 * that names what is missing when the answer is not one.
 */
export function readStats(json: unknown): Charts {
  if (!isRecord(json) || !isRecord(json.total) || !Array.isArray(json.days)) {
    throw new Error("not an /api/stats answer: it needs total and days");
  }
  const days = new Map<string, number>();
  for (const entry of json.days as unknown[]) {
    if (!isRecord(entry) || typeof entry.day !== "string" || !isDay(entry.day)) continue;
    days.set(entry.day, sum(dimension(entry.counts, "games")));
  }
  const perDay: Bar[] = [];
  const sorted = [...days.keys()].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first !== undefined && last !== undefined) {
    // The server lists only the days something was counted; the others had no game.
    // The server keeps 90 days; a saved file holding more shows its last 90 only.
    const start = Math.max(Date.parse(first), Date.parse(last) - (KEEP_DAYS - 1) * DAY_MS);
    for (let time = start; time <= Date.parse(last); time += DAY_MS) {
      const day = new Date(time).toISOString().slice(0, 10);
      perDay.push({ label: day, value: days.get(day) ?? 0 });
    }
  }
  return {
    release: typeof json.release === "string" ? json.release : "",
    since: typeof json.since === "string" ? json.since : null,
    perDay,
    maps: dimension(json.total, "map").sort(
      (a, b) => b.value - a.value || a.label.localeCompare(b.label),
    ),
    // Ranges such as 0-2, 2-5 and 40+, in the order of their first number.
    minutes: dimension(json.total, "minutes").sort(
      (a, b) => Number.parseInt(a.label, 10) - Number.parseInt(b.label, 10),
    ),
  };
}
