import { createHmac } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/accounts.ts";
import { ClientErrors, loadClientErrors } from "../src/client-errors.ts";
import { backup, NewerSchemaError, openDatabase, readDocument } from "../src/database.ts";
import { ignoredStoreFiles, importJsonStores, ImportError } from "../src/import-json.ts";
import { silentLogger, type Logger } from "../src/log.ts";
import { Moderation } from "../src/moderation.ts";
import { loadGames } from "../src/saved-games.ts";
import { createGameServer } from "../src/server.ts";
import type { SqlDriver } from "../src/sql/driver.ts";
import { openNodeSqlite } from "../src/sql/node-sqlite.ts";
import { loadUsage, UsageStats } from "../src/usage.ts";
import { FakeTransport } from "./support/fake-transport.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "json-stores");
const NOW = Date.UTC(2026, 10, 7, 12);

let dirs: string[] = [];
let opened: SqlDriver[] = [];

afterEach(() => {
  for (const db of opened) db.close();
  opened = [];
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** A data directory holding a copy of one fixture, and data.db opened in it. */
function dataFrom(fixture: string): { dir: string; db: SqlDriver } {
  const dir = mkdtempSync(join(tmpdir(), "frontfall-import-"));
  dirs.push(dir);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  const db = openDatabase(dir, openNodeSqlite);
  opened.push(db);
  return { dir, db };
}

/** Every file of a directory, by its path in it. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .filter((name) => !name.startsWith("data.db"))
    .sort();
}

const stats = (): UsageStats => new UsageStats({ release: "1.0.0", maps: new Set(["world"]) });

describe("the one-time import of the JSON stores", () => {
  it("takes every store of a good data directory, and keeps the files renamed", () => {
    const { dir, db } = dataFrom("good");
    const imported = importJsonStores(db, dir, NOW);
    expect(imported.map(({ store, rows }) => [store, rows])).toEqual([
      ["accounts", 2],
      ["moderation key", 1],
      ["bans", 2],
      ["reports", 1],
      ["usage", 1],
      ["errors", 1],
      ["games", 1],
    ]);
    expect(files(dir)).toEqual([
      "accounts/accounts.json.imported",
      "games/gamefix1.json.imported",
      "moderation/bans.json.imported",
      "moderation/key.imported",
      "moderation/reports.json.imported",
      "usage/errors.json.imported",
      "usage/usage.json.bak.imported",
      "usage/usage.json.imported",
    ]);

    const accounts = new Accounts(db);
    expect(accounts.load()).toEqual({ usable: true });
    expect(accounts.size).toBe(2);
    expect(accounts.owner("fixture two")?.links).toHaveLength(1);
    // The salt comes along: a player is found by the service's id as before.
    expect(accounts.subject("discord", "x")).toBe(
      createHmac("sha256", "c2FsdC1vZi10aGUtZml4dHVyZS1hY2NvdW50cy0wMTIzNDU")
        .update("account:discord:x")
        .digest("base64url"),
    );

    const moderation = new Moderation(db, NOW);
    moderation.reload(NOW);
    expect(moderation.list(NOW).map((ban) => ban.target)).toEqual([
      "203.0.113.7",
      "Jm0pQ2xvd2Zy4kTe",
    ]);
    expect(moderation.read(NOW).reports.map((report) => report.name)).toEqual(["Troll"]);
    // The key comes along: the same address keeps its reference.
    const fresh = mkdtempSync(join(tmpdir(), "frontfall-import-"));
    dirs.push(fresh);
    const other = openDatabase(fresh, openNodeSqlite);
    opened.push(other);
    expect(moderation.ref("198.51.100.1")).not.toBe(new Moderation(other, NOW).ref("198.51.100.1"));
    expect(new Moderation(db, NOW).ref("198.51.100.1")).toBe(moderation.ref("198.51.100.1"));

    const usage = stats();
    expect(loadUsage(usage, db, NOW)).toBeUndefined();
    expect(usage.export(NOW).total.games).toEqual({ solo: 1 });
    const errors = new ClientErrors();
    expect(loadClientErrors(errors, db, NOW)).toBeUndefined();
    expect(errors.read(NOW, 30).groups).toHaveLength(1);
    expect(loadGames(db, "5e5e5e5e5e5e").games.map((game) => game.id)).toEqual(["gamefix1"]);

    // Once only: nothing is taken again, even if a file comes back; it is named instead.
    expect(ignoredStoreFiles(db, dir)).toEqual([]);
    writeFileSync(join(dir, "moderation", "bans.json"), "{ not json");
    expect(importJsonStores(db, dir, NOW + 1)).toEqual([]);
    expect(db.all("SELECT store FROM imports")).toHaveLength(7);
    expect(ignoredStoreFiles(db, dir)).toEqual([
      { store: "bans", file: join(dir, "moderation", "bans.json") },
    ]);
  });

  it("never imports into a data.db that has run, even a store it did not find then", () => {
    const { dir, db } = dataFrom("missing");
    expect(importJsonStores(db, dir, NOW)).toEqual([]);
    expect(db.all("SELECT store FROM imports")).toHaveLength(7);
    const moderation = new Moderation(db, NOW);
    moderation.ban("198.51.100.9", undefined, undefined, NOW);
    const key = moderation.ref("198.51.100.1");
    const accounts = new Accounts(db);
    expect(accounts.load()).toEqual({ usable: true });
    const ana = accounts.signIn("google", "1", "Ana", NOW);
    // Files of an old backup put back in the volume, or written by an older release after a rollback.
    cpSync(join(FIXTURES, "good"), dir, { recursive: true });
    expect(importJsonStores(db, dir, NOW + 1)).toEqual([]);
    const again = new Moderation(db, NOW);
    again.reload(NOW);
    expect(again.list(NOW).map((ban) => ban.target)).toEqual(["198.51.100.9"]);
    expect(again.ref("198.51.100.1")).toBe(key);
    const reread = new Accounts(db);
    expect(reread.load()).toEqual({ usable: true });
    expect(reread.subject("google", "1")).toBe(accounts.subject("google", "1"));
    expect(reread.get(ana.id)?.name).toBe("Ana");
    expect(reread.size).toBe(1);
    expect(ignoredStoreFiles(db, dir).map(({ store }) => store)).toEqual([
      "accounts",
      "moderation key",
      "bans",
      "reports",
      "usage",
      "usage",
      "errors",
      "games",
    ]);
  });

  it("finishes the renames of an import stopped after its commit, and leaves a file changed since", () => {
    const { dir, db } = dataFrom("good");
    importJsonStores(db, dir, NOW);
    // As if the process had stopped before renaming these two.
    const accountsFile = join(dir, "accounts", "accounts.json");
    const bansFile = join(dir, "moderation", "bans.json");
    renameSync(`${accountsFile}.imported`, accountsFile);
    renameSync(`${bansFile}.imported`, bansFile);
    writeFileSync(bansFile, JSON.stringify({ bans: [{ target: "198.51.100.3" }] }));
    expect(importJsonStores(db, dir, NOW + 1)).toEqual([]);
    expect(existsSync(accountsFile)).toBe(false);
    expect(existsSync(`${accountsFile}.imported`)).toBe(true);
    expect(ignoredStoreFiles(db, dir)).toEqual([{ store: "bans", file: bansFile }]);
  });

  it("keeps one ban a target when the file gives a target twice, the one that lasts longest", () => {
    const { dir, db } = dataFrom("missing");
    mkdirSync(join(dir, "moderation"));
    writeFileSync(
      join(dir, "moderation", "bans.json"),
      JSON.stringify({
        bans: [
          { target: "2001:db8::1", until: null, note: "first" },
          { target: "2001:db8::2", until: "2027-01-01", note: "same /64" },
          { target: "203.0.113.7", until: "2027-01-01" },
          { target: "::ffff:203.0.113.7", until: "2027-06-01", note: "later" },
        ],
      }),
    );
    const imported = importJsonStores(db, dir, NOW);
    expect(imported.map(({ store, rows }) => [store, rows])).toEqual([["bans", 2]]);
    const moderation = new Moderation(db, NOW);
    moderation.reload(NOW);
    expect(
      moderation.list(NOW).map(({ target, until, note }) => [target, until, note ?? null]),
    ).toEqual([
      ["2001:db8:0:0::/64", null, "first"],
      ["203.0.113.7", "2027-06-01T00:00:00.000Z", "later"],
    ]);
  });

  it("names the store when data.db refuses a write, and writes nothing", () => {
    const { dir, db: real } = dataFrom("good");
    const db: SqlDriver = {
      exec: (sql) => {
        real.exec(sql);
      },
      run: (sql, params) => {
        if (sql.startsWith("INSERT INTO accounts")) throw new Error("database or disk is full");
        real.run(sql, params);
      },
      all: (sql, params) => real.all(sql, params),
      get: (sql, params) => real.get(sql, params),
      close: () => {
        real.close();
      },
    };
    expect(() => importJsonStores(db, dir, NOW)).toThrow(ImportError);
    expect(() => importJsonStores(db, dir, NOW)).toThrow(
      /^accounts: .*accounts\.json does not go into data\.db \(database or disk is full\)/,
    );
    expect(real.all("SELECT store FROM imports")).toEqual([]);
    expect(files(dir).some((name) => name.endsWith(".imported"))).toBe(false);
  });

  it("goes on with the copy when the counts cannot be read at all", () => {
    const { dir, db } = dataFrom("good");
    const counts = join(dir, "usage", "usage.json");
    rmSync(counts);
    mkdirSync(counts);
    importJsonStores(db, dir, NOW);
    const usage = stats();
    expect(loadUsage(usage, db, NOW)).toBeUndefined();
    expect(existsSync(`${counts}.bak.imported`)).toBe(true);
  });

  it("goes on with the copy of the last save when the counts are missing", () => {
    const { dir, db } = dataFrom("bak-only");
    expect(
      importJsonStores(db, dir, NOW).map(({ store, files: read }) => [store, read.length]),
    ).toEqual([["usage", 1]]);
    expect(files(dir)).toEqual(["usage/usage.json.bak.imported"]);
    const usage = stats();
    expect(loadUsage(usage, db, NOW)).toBeUndefined();
    expect(usage.export(NOW).total.games).toEqual({ solo: 1 });
  });

  it("goes on with the copy when the counts are damaged, and leaves a file set aside alone", () => {
    const { dir, db } = dataFrom("broken");
    importJsonStores(db, dir, NOW);
    expect(files(dir)).toEqual([
      "usage/usage.json.bak.imported",
      "usage/usage.json.broken",
      "usage/usage.json.imported",
    ]);
    const usage = stats();
    expect(loadUsage(usage, db, NOW)).toBeUndefined();
    expect(usage.export(NOW).total.games).toEqual({ solo: 1 });
  });

  it("imports nothing from a data directory without stores", () => {
    const { dir, db } = dataFrom("missing");
    expect(importJsonStores(db, dir, NOW)).toEqual([]);
    // Every store is done all the same: a file that shows up later is never imported.
    expect(db.all("SELECT store, files FROM imports")).toHaveLength(7);
    expect(db.all("SELECT store FROM imports WHERE files != '[]'")).toEqual([]);
    expect(readDocument(db, "usage")).toBeUndefined();
  });

  it.each([
    ["accounts", "accounts/accounts.json", "{ not json", "does not read"],
    ["bans", "moderation/bans.json", JSON.stringify({ bans: [{ target: "nobody" }] }), "entry 1"],
    ["reports", "moderation/reports.json", "{", "does not read"],
    ["moderation key", "moderation/key", "short", "64 hex digits"],
    ["errors", "usage/errors.json", "[]", "does not read"],
    ["usage", "usage/usage.json.bak", "{", "and its .bak copy do not read"],
  ])(
    "stops rather than start without %s that do not read, writing nothing",
    (store, file, text, says) => {
      const { dir, db } = dataFrom("good");
      writeFileSync(join(dir, file), text);
      if (store === "usage") writeFileSync(join(dir, "usage", "usage.json"), "{");
      let thrown: unknown;
      try {
        importJsonStores(db, dir, NOW);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ImportError);
      expect((thrown as ImportError).store).toBe(store);
      expect((thrown as Error).message).toContain(says);
      // Nothing half done: no row, and every file where it was.
      expect(db.all("SELECT store FROM imports")).toEqual([]);
      expect(db.all("SELECT id FROM accounts")).toEqual([]);
      expect(files(dir).some((name) => name.endsWith(".imported"))).toBe(false);
    },
  );

  it("stops on a file it cannot read at all", () => {
    const { dir, db } = dataFrom("good");
    rmSync(join(dir, "accounts", "accounts.json"));
    mkdirSync(join(dir, "accounts", "accounts.json"));
    expect(() => importJsonStores(db, dir, NOW)).toThrow(/accounts: .* cannot be read \(EISDIR\)/);
  });

  it("keeps a saved game that does not read for the load to refuse, as before", () => {
    const { dir, db } = dataFrom("good");
    writeFileSync(join(dir, "games", "broken.json"), "{");
    importJsonStores(db, dir, NOW);
    expect(loadGames(db, "5e5e5e5e5e5e")).toEqual({
      games: [expect.objectContaining({ id: "gamefix1" }) as unknown],
      refused: [{ file: "broken", reason: "unreadable" }],
    });
  });
});

describe("data.db", () => {
  it("is readable by the server's user only, in WAL mode", () => {
    const { dir, db } = dataFrom("missing");
    db.run("INSERT INTO meta (key, value) VALUES ('x', 'y')");
    expect(statSync(join(dir, "data.db")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "data.db-wal")).mode & 0o777).toBe(0o600);
    expect(db.get<{ journal_mode: string }>("PRAGMA journal_mode")).toEqual({
      journal_mode: "wal",
    });
    // A database left readable by others is made private again at the next open.
    chmodSync(join(dir, "data.db"), 0o644);
    opened.push(openDatabase(dir, openNodeSqlite));
    expect(statSync(join(dir, "data.db")).mode & 0o777).toBe(0o600);
  });

  it("brings the schema up to date once", () => {
    const { dir, db } = dataFrom("missing");
    expect(db.get("PRAGMA user_version")).toEqual({ user_version: 1 });
    const again = openDatabase(dir, openNodeSqlite);
    opened.push(again);
    expect(again.get("PRAGMA user_version")).toEqual({ user_version: 1 });
  });

  it("is not opened when a newer release wrote it", () => {
    const { dir, db } = dataFrom("missing");
    db.exec("PRAGMA user_version = 2");
    expect(() => openDatabase(dir, openNodeSqlite)).toThrow(NewerSchemaError);
    expect(() => openDatabase(dir, openNodeSqlite)).toThrow(
      "data.db is from a newer release (schema 2); this one knows schema 1",
    );
  });

  it("leaves no file behind when a backup fails", () => {
    const { dir } = dataFrom("missing");
    const closed = openDatabase(dir, openNodeSqlite);
    closed.close();
    const file = join(dir, "backup.db");
    expect(() => {
      backup(closed, file);
    }).toThrow();
    expect(existsSync(file)).toBe(false);
  });
});

describe("a server on an earlier data directory", () => {
  it("imports it at its first start, and logs each store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "frontfall-import-"));
    dirs.push(dir);
    cpSync(join(FIXTURES, "good"), dir, { recursive: true });
    const lines: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      info: (event, fields) => lines.push(`${event} ${JSON.stringify(fields)}`),
    };
    const server = createGameServer({
      transport: new FakeTransport(),
      staticRoot: dir,
      version: "test",
      drainMs: 0,
      dataDir: dir,
      simulation: "5e5e5e5e5e5e",
      logger,
    });
    await server.close();
    expect(lines).toContain('store_imported {"store":"accounts","files":1,"rows":2}');
    expect(lines.some((line) => line.startsWith("game_restored"))).toBe(true);
    expect(existsSync(join(dir, "data.db"))).toBe(true);
  });

  it("does not start on a store that does not import", () => {
    const dir = mkdtempSync(join(tmpdir(), "frontfall-import-"));
    dirs.push(dir);
    mkdirSync(join(dir, "accounts"));
    writeFileSync(join(dir, "accounts", "accounts.json"), "{ not json");
    expect(() =>
      createGameServer({
        transport: new FakeTransport(),
        staticRoot: dir,
        version: "test",
        dataDir: dir,
      }),
    ).toThrow(ImportError);
  });
});
