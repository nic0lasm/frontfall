/**
 * frontfall-admin: the operator's command for data.db, run by Bun beside the
 * server, in its container: `docker exec <container> frontfall-admin bans list`.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { ADMIN_USAGE, runAdmin } from "./admin-command.ts";
import { systemClock } from "./clock.ts";
import { databaseFile, NewerSchemaError, openDatabase } from "./database.ts";
import { openBunSqlite } from "./sql/bun-sqlite.ts";
import type { SqlDriver } from "./sql/driver.ts";

const args = process.argv.slice(2);
const { values } = parseArgs({
  args,
  allowPositionals: true,
  strict: false,
  options: { data: { type: "string" } },
});
const dataDir = typeof values.data === "string" ? values.data : process.env.FRONTFALL_DATA;
if (!dataDir || args.length === 0) {
  console.log(
    dataDir
      ? ADMIN_USAGE
      : `No data directory: set FRONTFALL_DATA or pass --data.\n\n${ADMIN_USAGE}`,
  );
  process.exit(2);
}
// A wrong directory would get a new, empty database: the server makes data.db, never this command.
if (!existsSync(databaseFile(dataDir))) {
  console.log(`No data.db in ${dataDir}: the server makes it at its first start.`);
  process.exit(1);
}
const port = process.env.PORT ?? "8080";

/** Asks the server on this machine to read the ban list again, and close the connections now banned. */
async function reload(): Promise<string> {
  try {
    const answer = await fetch(`http://127.0.0.1:${port}/admin/bans`, { method: "POST" });
    if (!answer.ok)
      return `the server answered ${String(answer.status)}: it reads the list at its next start`;
    const { closed } = (await answer.json()) as { closed: number };
    return `the server reads the list again; connections closed: ${String(closed)}`;
  } catch {
    return "no server answered: it reads the list at its next start";
  }
}

let db: SqlDriver;
try {
  db = openDatabase(dataDir, openBunSqlite);
} catch (error) {
  if (!(error instanceof NewerSchemaError)) throw error;
  console.log(`${error.message}: use the frontfall-admin of that release.`);
  process.exit(1);
}
try {
  process.exitCode = await runAdmin(args, {
    db,
    now: systemClock.now(),
    print: (text) => {
      console.log(text);
    },
    reload,
  });
} finally {
  db.close();
}
