import { format, Stats } from "./playtest-report.ts";

// Prints how many games were played to the end, from a server's public
// counters. See docs/playtest.md, "Measuring a playtest".
//   FRONTFALL_URL=https://nclsmgr.com/frontfall/ bun run playtest-report [YYYY-MM-DD]

const base = new URL(process.env.FRONTFALL_URL ?? "https://nclsmgr.com/frontfall/");
if (!base.pathname.endsWith("/")) base.pathname += "/";
const since = process.argv[2];
if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("usage: playtest-report [YYYY-MM-DD]");
  process.exit(2);
}

const response = await fetch(new URL("api/stats", base), { signal: AbortSignal.timeout(10_000) });
if (!response.ok) {
  console.error(`${base.href}api/stats answered ${String(response.status)}`);
  process.exit(1);
}
console.log(format(Stats.parse(await response.json()), since));
