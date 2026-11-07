import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/database.ts";
import type { SqlDriver } from "../../src/sql/driver.ts";
import { openNodeSqlite } from "../../src/sql/node-sqlite.ts";

/** A data directory of its own with data.db open in it, on `node:sqlite` as under Vitest. */
export interface TempDatabase {
  dir: string;
  db: SqlDriver;
  /** Opens data.db again, as a restart does; the earlier handle stays open. */
  reopen(): SqlDriver;
  remove(): void;
}

export function tempDatabase(prefix = "frontfall-data-"): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const opened: SqlDriver[] = [openDatabase(dir, openNodeSqlite)];
  return {
    dir,
    get db() {
      return opened[0] as SqlDriver;
    },
    reopen() {
      const db = openDatabase(dir, openNodeSqlite);
      opened.push(db);
      return db;
    },
    remove() {
      for (const db of opened) {
        try {
          db.close();
        } catch {
          // Closed by the test already.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Opens data.db of a data directory a server used, to look at what it kept. */
export function dataOf(dir: string): SqlDriver {
  return openDatabase(dir, openNodeSqlite);
}

/** The accounts a server kept in the data directory, as stored. */
export function storedAccounts(
  dir: string,
): { id: string; name: string; [key: string]: unknown }[] {
  const db = dataOf(dir);
  try {
    return db
      .all<{ body: string }>("SELECT body FROM accounts ORDER BY rowid")
      .map(({ body }) => JSON.parse(body) as { id: string; name: string });
  } finally {
    db.close();
  }
}

/** Everything data.db holds of the accounts, as text, to look for what must not be there. */
export function accountsText(dir: string): string {
  const db = dataOf(dir);
  try {
    return JSON.stringify([
      db.all("SELECT * FROM accounts"),
      db.all("SELECT * FROM meta WHERE key LIKE 'accounts.%'"),
      db.all("SELECT * FROM documents WHERE name LIKE 'accounts.%'"),
    ]);
  } finally {
    db.close();
  }
}
