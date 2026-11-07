import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { accountsFile, parseAccountsFile, writeAccounts } from "./accounts.ts";
import { ClientErrors, clientErrorsFile } from "./client-errors.ts";
import { writeDocument } from "./database.ts";
import {
  moderationFiles,
  parseBans,
  parseKey,
  parseReports,
  writeBans,
  writeKey,
  writeReports,
} from "./moderation.ts";
import { gamesDirectory, MAX_SAVED_BYTES, parseSavedGame, writeSavedGame } from "./saved-games.ts";
import { transaction, type SqlDriver } from "./sql/driver.ts";
import { usageFile, UsageStats } from "./usage.ts";

/** What a file read for the import becomes once data.db holds it: the same name, with this after it. */
export const IMPORTED = ".imported";

/** A JSON store that exists and does not read: the server does not start rather than start empty. */
export class ImportError extends Error {
  constructor(
    readonly store: string,
    readonly file: string,
    reason: string,
  ) {
    super(
      `${store}: ${file} ${reason}; fix it, or move it out of the data directory to start without it`,
    );
  }
}

/** One store taken into data.db. */
export interface Imported {
  store: string;
  /** The files read, now renamed with `.imported`. */
  files: string[];
  /** Rows, or documents, written. */
  rows: number;
}

/** A store read and checked, written once every store has been. */
interface Planned extends Imported {
  write(db: SqlDriver): void;
}

function readText(store: string, file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new ImportError(
      store,
      file,
      `cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`,
    );
  }
}

/**
 * A store kept as one file with a copy of the last save beside it, as the
 * usage counts: the file if it reads, else the copy, as the server of the
 * earlier releases fell back on it, also when the file cannot be read at
 * all. Both are renamed once imported.
 */
function withCopy(
  store: string,
  file: string,
  reads: (text: string) => boolean,
): { text: string; files: string[] } | undefined {
  const copy = `${file}.bak`;
  const files = [file, copy].filter((one) => existsSync(one));
  const [only] = files;
  if (only === undefined) return undefined;
  if (files.length === 1) {
    const text = readText(store, only);
    if (reads(text)) return { text, files };
    throw new ImportError(store, only, "does not read");
  }
  for (const one of files) {
    let text: string;
    try {
      text = readFileSync(one, "utf8");
    } catch {
      continue;
    }
    if (reads(text)) return { text, files };
  }
  throw new ImportError(store, file, "and its .bak copy do not read");
}

function accounts(dataDir: string): Planned | undefined {
  const file = accountsFile(dataDir);
  if (!existsSync(file)) return undefined;
  const parsed = parseAccountsFile(readText("accounts", file));
  if (!parsed) throw new ImportError("accounts", file, "does not read");
  return {
    store: "accounts",
    files: [file],
    rows: parsed.accounts.length,
    write: (db) => {
      writeAccounts(db, parsed);
    },
  };
}

function moderationKey(dataDir: string): Planned | undefined {
  const file = moderationFiles(dataDir).key;
  if (!existsSync(file)) return undefined;
  const key = parseKey(readText("moderation key", file));
  if (key === undefined) throw new ImportError("moderation key", file, "is not 64 hex digits");
  return {
    store: "moderation key",
    files: [file],
    rows: 1,
    write: (db) => {
      writeKey(db, key);
    },
  };
}

function bans(dataDir: string): Planned | undefined {
  const file = moderationFiles(dataDir).bans;
  if (!existsSync(file)) return undefined;
  const text = readText("bans", file);
  let list: ReturnType<typeof parseBans>;
  try {
    list = parseBans(text);
  } catch (error) {
    throw new ImportError("bans", file, `does not read: ${(error as Error).message}`);
  }
  return {
    store: "bans",
    files: [file],
    rows: list.length,
    write: (db) => {
      writeBans(db, list);
    },
  };
}

function reports(dataDir: string): Planned | undefined {
  const file = moderationFiles(dataDir).reports;
  if (!existsSync(file)) return undefined;
  const list = parseReports(readText("reports", file));
  if (!list) throw new ImportError("reports", file, "does not read");
  return {
    store: "reports",
    files: [file],
    rows: list.length,
    write: (db) => {
      writeReports(db, list);
    },
  };
}

function usage(dataDir: string): Planned | undefined {
  const found = withCopy("usage", usageFile(dataDir), (text) =>
    new UsageStats({ release: "import", maps: new Set() }).restore(text),
  );
  if (!found) return undefined;
  return {
    store: "usage",
    files: found.files,
    rows: 1,
    write: (db) => {
      writeDocument(db, "usage", found.text);
    },
  };
}

function errors(dataDir: string): Planned | undefined {
  const file = clientErrorsFile(dataDir);
  if (!existsSync(file)) return undefined;
  const text = readText("errors", file);
  if (!new ClientErrors().restore(text)) throw new ImportError("errors", file, "does not read");
  return {
    store: "errors",
    files: [file],
    rows: 1,
    write: (db) => {
      writeDocument(db, "errors", text);
    },
  };
}

/**
 * Saved games, one file each. As before data.db, a game that does not read
 * does not stop the start: it is kept as a save the next load refuses, and
 * logs. A save cut short (`.json.tmp`) is only renamed.
 */
/** The files of the games directory not yet imported, by name. */
function gameNames(dataDir: string): string[] {
  try {
    return readdirSync(gamesDirectory(dataDir))
      .filter((name) => !name.endsWith(IMPORTED))
      .sort();
  } catch {
    return [];
  }
}

function games(dataDir: string): Planned | undefined {
  const directory = gamesDirectory(dataDir);
  const names = gameNames(dataDir);
  if (names.length === 0) return undefined;
  const saves: { id: string; simulation: string; text: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(directory, name);
    let text = "";
    try {
      if (statSync(file).size <= MAX_SAVED_BYTES) text = readFileSync(file, "utf8");
    } catch {
      // Unreadable: kept empty, which the load refuses.
    }
    const parsed = parseSavedGame(text);
    saves.push({ id: name.slice(0, -".json".length), simulation: parsed?.simulation ?? "", text });
  }
  return {
    store: "games",
    files: names.map((name) => join(directory, name)),
    rows: saves.length,
    write: (db) => {
      for (const save of saves) writeSavedGame(db, save.id, save.simulation, save.text);
    },
  };
}

/** A JSON store of the earlier releases. */
interface Store {
  name: string;
  read: (dataDir: string) => Planned | undefined;
  /** The files it was kept in, as the earlier releases named them, whether they exist or not. */
  files: (dataDir: string) => string[];
}

const STORES: Store[] = [
  { name: "accounts", read: accounts, files: (dir) => [accountsFile(dir)] },
  { name: "moderation key", read: moderationKey, files: (dir) => [moderationFiles(dir).key] },
  { name: "bans", read: bans, files: (dir) => [moderationFiles(dir).bans] },
  { name: "reports", read: reports, files: (dir) => [moderationFiles(dir).reports] },
  { name: "usage", read: usage, files: (dir) => [usageFile(dir), `${usageFile(dir)}.bak`] },
  { name: "errors", read: errors, files: (dir) => [clientErrorsFile(dir)] },
  {
    name: "games",
    read: games,
    files: (dir) => gameNames(dir).map((name) => join(gamesDirectory(dir), name)),
  },
];

/** A file read for the import, as the imports table keeps it: its path in the data directory, and a hash of its bytes. */
interface Taken {
  file: string;
  sha256: string;
}

/** The SHA-256 of a file's bytes; empty when it cannot be read. */
function hashOf(file: string): string {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Renames the files an import read and could not rename, as when the
 * process stopped between the commit and the renames: each one still there,
 * with no `.imported` file beside it, and the same bytes as when it was read.
 */
function finishRenames(dataDir: string, files: string): void {
  let taken: unknown;
  try {
    taken = JSON.parse(files);
  } catch {
    return;
  }
  if (!Array.isArray(taken)) return;
  for (const entry of taken as Partial<Taken>[]) {
    if (typeof entry.file !== "string" || typeof entry.sha256 !== "string") continue;
    const file = join(dataDir, entry.file);
    if (!existsSync(file) || existsSync(`${file}${IMPORTED}`)) continue;
    if (hashOf(file) === entry.sha256) renameSync(file, `${file}${IMPORTED}`);
  }
}

/**
 * Takes every JSON store the earlier releases kept in the data directory into
 * data.db, once: at the first start on a new data.db, before the server
 * writes anything to it, and again only until an import gets through.
 * Every store is read and checked first, and a store that exists and does
 * not read, even from its `.bak` copy, throws before anything is written.
 * Then all of them are written in one transaction, which
 * marks every store as done, found or not, and each file read is renamed
 * with `.imported`: kept, so the step can be undone by renaming them back
 * and removing data.db. At any later start, nothing is imported: a file of a
 * store that shows up again is left where it is (`ignoredStoreFiles`).
 */
export function importJsonStores(db: SqlDriver, dataDir: string, now: number): Imported[] {
  const recorded = db.all<{ files: string }>("SELECT files FROM imports");
  if (recorded.length > 0) {
    for (const { files } of recorded) finishRenames(dataDir, files);
    return [];
  }
  const planned = STORES.map(({ name, read }) => ({ name, plan: read(dataDir) }));
  transaction(db, () => {
    for (const { name, plan } of planned) {
      const taken: Taken[] = [];
      if (plan) {
        try {
          plan.write(db);
        } catch (error) {
          throw new ImportError(
            name,
            plan.files[0] ?? dataDir,
            `does not go into data.db (${(error as Error).message})`,
          );
        }
        for (const file of plan.files)
          taken.push({ file: relative(dataDir, file), sha256: hashOf(file) });
      }
      db.run("INSERT INTO imports (store, at, files) VALUES (?, ?, ?)", [
        name,
        now,
        JSON.stringify(taken),
      ]);
    }
  });
  const done = planned.flatMap(({ plan }) => (plan ? [plan] : []));
  for (const plan of done) {
    for (const file of plan.files) renameSync(file, `${file}${IMPORTED}`);
  }
  return done.map(({ store, files, rows }) => ({ store, files, rows }));
}

/**
 * The files of the JSON stores in the data directory once data.db has
 * imported them: written by an earlier release after a rollback, or put back
 * from an old backup. They are never read, since data.db holds those stores
 * already, and the server logs each one.
 */
export function ignoredStoreFiles(
  db: SqlDriver,
  dataDir: string,
): { store: string; file: string }[] {
  if (db.get("SELECT 1 AS one FROM imports LIMIT 1") === undefined) return [];
  return STORES.flatMap(({ name, files }) =>
    files(dataDir)
      .filter((file) => existsSync(file))
      .map((file) => ({ store: name, file })),
  );
}
