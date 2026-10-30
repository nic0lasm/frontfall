import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readTotal, usageReport } from "./usage-report.ts";

// Prints what a server's /api/stats says about how the game is played.
// Usage: pnpm usage:report https://nclsmgr.com/frontfall/api/stats
//        pnpm usage:report stats.json

const source = process.argv[2];
if (!source) {
  console.error("usage: pnpm usage:report <address of /api/stats | file.json>");
  process.exit(2);
}
const text = URL.canParse(source)
  ? await (await fetch(source)).text()
  : readFileSync(resolve(process.env["INIT_CWD"] ?? ".", source), "utf8");
const json: unknown = JSON.parse(text);
const record = json as { since?: string | null; release?: string };
console.log(usageReport(readTotal(json), record.since ?? null, record.release ?? "?"));
