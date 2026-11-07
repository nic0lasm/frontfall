import { chmodSync, closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { OpenSql, SqlDriver } from "./sql/driver.ts";

/** The file every store of the server is kept in, in the data directory. */
export function databaseFile(dataDir: string): string {
  return join(dataDir, "data.db");
}

/**
 * The schema, one step a version; `user_version` says which ran. A step is
 * never changed once released: a new one is added after it.
 */
const STEPS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE accounts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
   CREATE TABLE bans (target TEXT PRIMARY KEY, until TEXT, note TEXT);
   CREATE TABLE reports (
     seq INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     game TEXT NOT NULL,
     reason TEXT NOT NULL,
     reporter TEXT NOT NULL,
     player INTEGER NOT NULL,
     name TEXT NOT NULL,
     target TEXT
   );
   CREATE TABLE documents (name TEXT PRIMARY KEY, body TEXT NOT NULL);
   CREATE TABLE games (id TEXT PRIMARY KEY, simulation TEXT NOT NULL, body TEXT NOT NULL);
   CREATE TABLE imports (store TEXT PRIMARY KEY, at INTEGER NOT NULL, files TEXT NOT NULL);`,
];

/** A data.db from a newer release, whose schema this one does not know: it is not opened. */
export class NewerSchemaError extends Error {
  constructor(
    readonly schema: number,
    readonly known: number,
  ) {
    super(
      `data.db is from a newer release (schema ${String(schema)}); this one knows schema ${String(known)}`,
    );
  }
}

/** The files SQLite keeps beside the database in WAL mode, as private as it is. */
function privateFiles(file: string): void {
  for (const one of [file, `${file}-wal`, `${file}-shm`]) {
    if (existsSync(one)) chmodSync(one, 0o600);
  }
}

/**
 * Opens `data.db` in the data directory, readable by the server's user only,
 * in WAL mode, with the schema brought up to date; one from a newer release
 * throws `NewerSchemaError`. Several processes may
 * open it at once, such as the server and the admin command: a writer waits
 * up to 5 seconds for another.
 */
export function openDatabase(dataDir: string, open: OpenSql): SqlDriver {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = databaseFile(dataDir);
  // Created first with its mode: SQLite gives the -wal and -shm files the mode of the database.
  closeSync(openSync(file, "a", 0o600));
  chmodSync(file, 0o600);
  const db = open(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    const { user_version: version } = db.get<{ user_version: number }>("PRAGMA user_version") ?? {
      user_version: 0,
    };
    // Rows of a later schema could be read wrong, and written over.
    if (version > STEPS.length) throw new NewerSchemaError(version, STEPS.length);
    for (let step = version; step < STEPS.length; step++) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(STEPS[step] ?? "");
        db.exec(`PRAGMA user_version = ${String(step + 1)}`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    db.close();
    throw error;
  }
  privateFiles(file);
  return db;
}

/**
 * Writes a consistent copy of the database to `target`, which must not
 * exist, readable by its owner only. `VACUUM INTO` reads one snapshot while
 * the server goes on writing; copying `data.db` itself could catch a page
 * half written, or leave out what is still in `data.db-wal`.
 */
export function backup(db: SqlDriver, target: string): void {
  // Made empty first, with its mode, so that the copy is never readable by others; SQLite writes into it.
  try {
    closeSync(openSync(target, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`${target} already exists`, { cause: error });
    throw error;
  }
  try {
    db.run("VACUUM INTO ?", [target]);
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }
}

/** A text value of the `meta` table. */
export function readMeta(db: SqlDriver, key: string): string | undefined {
  return db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key])?.value;
}

export function writeMeta(db: SqlDriver, key: string, value: string): void {
  db.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** A JSON document of the `documents` table, as text. */
export function readDocument(db: SqlDriver, name: string): string | undefined {
  return db.get<{ body: string }>("SELECT body FROM documents WHERE name = ?", [name])?.body;
}

export function writeDocument(db: SqlDriver, name: string, body: string): void {
  db.run(
    "INSERT INTO documents (name, body) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET body = excluded.body",
    [name, body],
  );
}
