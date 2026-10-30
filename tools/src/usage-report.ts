// Reads an /api/stats answer and says what it shows about how the game is
// played: where games are lost, how long they last, what goes unused and how
// smooth the map is. No network here, so the tests run it on plain objects.

type Tally = Record<string, Record<string, number>>;

/** Games below this many make a rate a guess rather than a finding. */
const MIN_GAMES = 10;

const OUTCOMES = ["victory", "defeat", "left", "closed", "disconnected"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `total` of an /api/stats answer; throws an error naming what is missing. */
export function readTotal(json: unknown): Tally {
  if (!isRecord(json) || !isRecord(json["total"])) {
    throw new Error("not an /api/stats answer: it needs total");
  }
  const tally: Tally = {};
  for (const [dimension, values] of Object.entries(json["total"])) {
    if (!isRecord(values)) continue;
    const counts: Record<string, number> = {};
    for (const [value, count] of Object.entries(values)) {
      if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
        counts[value] = count;
      }
    }
    tally[dimension] = counts;
  }
  return tally;
}

/** Outcomes of one crossing, per value of the setting: `{ easy: { defeat: 3 } }`. */
function crossed(total: Tally, dimension: string): Map<string, Record<string, number>> {
  const rows = new Map<string, Record<string, number>>();
  for (const [key, count] of Object.entries(total[dimension] ?? {})) {
    const cut = key.lastIndexOf(".");
    if (cut < 0) continue;
    const row = rows.get(key.slice(0, cut)) ?? {};
    row[key.slice(cut + 1)] = (row[key.slice(cut + 1)] ?? 0) + count;
    rows.set(key.slice(0, cut), row);
  }
  return rows;
}

const sum = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((a, b) => a + b, 0);

const percent = (part: number, whole: number): string =>
  whole === 0 ? "-" : `${String(Math.round((100 * part) / whole))} %`;

/** A table of a crossing: one row per value, a column per outcome, the win rate last. */
function crossTable(title: string, total: Tally, dimension: string, order?: string[]): string[] {
  const rows = [...crossed(total, dimension)];
  if (rows.length === 0) return [];
  if (order) rows.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  else rows.sort(([, a], [, b]) => sum(b) - sum(a));
  const lines = [
    `### ${title}`,
    "",
    `| | games | ${OUTCOMES.join(" | ")} | wins |`,
    `|---|---|${OUTCOMES.map(() => "---").join("|")}|---|`,
  ];
  for (const [value, counts] of rows) {
    const games = sum(counts);
    const cells = OUTCOMES.map((outcome) => String(counts[outcome] ?? 0));
    const rate =
      games >= MIN_GAMES
        ? percent(counts["victory"] ?? 0, games)
        : `${percent(counts["victory"] ?? 0, games)} (few)`;
    lines.push(`| ${value} | ${String(games)} | ${cells.join(" | ")} | ${rate} |`);
  }
  return [...lines, ""];
}

function share(total: Tally, dimension: string, whole?: number): string[] {
  const counts = total[dimension] ?? {};
  const all = whole ?? sum(counts);
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([value, count]) => `${value} ${percent(count, all)} (${String(count)})`);
}

/** The report, as Markdown. */
export function usageReport(total: Tally, since: string | null, release: string): string {
  const games = sum(total["games"] ?? {});
  const out: string[] = [
    "# How Frontfall is played",
    "",
    `Release ${release}, counting since ${since ?? "?"}: ${String(games)} games. ${games < MIN_GAMES * 3 ? "**Too few games for rates; read them as hints.**" : ""}`,
    "",
    "## Who and what",
    "",
    `- Modes: ${share(total, "games", games).join(", ")}`,
    `- Maps: ${share(total, "map", games).join(", ")}`,
    `- Devices: ${share(total, "device", games).join(", ")}`,
    `- Difficulty: ${share(total, "difficulty", games).join(", ")}`,
    `- Length: ${share(total, "minutes", games).join(", ")}`,
    `- First order: ${share(total, "first_order", games).join(", ")}`,
    "",
    "## How games end",
    "",
  ];
  const outcomes = crossed({ o: Object.fromEntries(Object.entries(total["outcome"] ?? {})) }, "o");
  const byMode = [...outcomes].map(
    ([mode, counts]) =>
      `${mode}: ${OUTCOMES.map((o) => `${o} ${String(counts[o] ?? 0)}`).join(", ")}`,
  );
  out.push(...byMode.map((line) => `- ${line}`), "");
  const early = total["early"] ?? {};
  if (sum(early) > 0) {
    out.push(
      `Games over in under two minutes: ${String(sum(early))} of ${String(games)} (${percent(sum(early), games)}): ${share(total, "early").join(", ")}. These are first-game exits, beaten or gone at once.`,
      "",
    );
  }
  out.push(
    ...crossTable("By difficulty", total, "by_difficulty", ["easy", "normal", "hard"]),
    ...crossTable("By map", total, "by_map"),
    ...crossTable("By game length", total, "by_length", [
      "0-2",
      "2-5",
      "5-10",
      "10-20",
      "20-40",
      "40+",
    ]),
    ...crossTable("By device", total, "by_device"),
    ...crossTable("With or without nations", total, "by_nations"),
    ...crossTable("By feature used", total, "used_by"),
  );
  const unused = Object.keys(total["used"] ?? {});
  if (unused.length > 0) {
    out.push(
      "## Features",
      "",
      `Used in some game: ${share(total, "used", games).join(", ")}. A feature missing from this list was never used in the games counted.`,
      "",
    );
  }
  if (total["peak"])
    out.push(`Largest share of the land held: ${share(total, "peak").join(", ")}.`, "");
  if (total["frame"]) {
    out.push(
      "## Smoothness (median frame time of a game)",
      "",
      `- By view: ${share(total, "frame").join(", ")}`,
      `- By device: ${share(total, "frame_by").join(", ")}`,
      "",
    );
  }
  const votes = total["votes_by"];
  if (votes) {
    out.push(
      "## Votes",
      "",
      `${share(total, "votes_by").join(", ")}. Reasons: ${share(total, "reasons").join(", ") || "none"}.`,
      "",
    );
  }
  if (total["errors"]) out.push("## Errors", "", `${share(total, "errors").join(", ")}.`, "");
  return out.join("\n");
}
