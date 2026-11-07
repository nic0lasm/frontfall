import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "../src/accounts.ts";
import { openDatabase } from "../src/database.ts";
import { importJsonStores } from "../src/import-json.ts";
import { Moderation } from "../src/moderation.ts";
import { createGameServer } from "../src/server.ts";
import { openBunSqlite } from "../src/sql/bun-sqlite.ts";
import { transaction } from "../src/sql/driver.ts";

const ADMIN = join(import.meta.dir, "..", "src", "admin-main.ts");
const FIXTURES = join(import.meta.dir, "..", "test", "fixtures", "json-stores");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "frontfall-admin-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs frontfall-admin as an operator would, with Bun, on `dir`. */
function admin(...args: string[]): { status: number; out: string } {
  const run = Bun.spawnSync(["bun", ADMIN, ...args], {
    env: { ...process.env, FRONTFALL_DATA: dir, PORT: "9" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { status: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

describe("bun:sqlite", () => {
  it("runs the stores as node:sqlite does, transactions included", () => {
    const db = openDatabase(dir, openBunSqlite);
    try {
      expect(db.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
      expect(statSync(join(dir, "data.db")).mode & 0o777).toBe(0o600);
      const accounts = new Accounts(db);
      expect(accounts.load()).toEqual({ usable: true });
      const ana = accounts.signIn("google", "1", "Ana", Date.now());
      const again = new Accounts(db);
      again.load();
      expect(again.get(ana.id)?.name).toBe("Ana");
      expect(() =>
        transaction(db, () => {
          db.run("INSERT INTO meta (key, value) VALUES ('x', 'y')");
          throw new Error("undone");
        }),
      ).toThrow("undone");
      expect(db.get("SELECT value FROM meta WHERE key = 'x'")).toBeUndefined();
      expect(db.get<{ n: Uint8Array }>("SELECT ? AS n", [Uint8Array.of(1)])).toEqual({
        n: Uint8Array.of(1),
      });
    } finally {
      db.close();
    }
  });

  it("imports the JSON stores of an earlier release", () => {
    cpSync(join(FIXTURES, "good"), dir, { recursive: true });
    const db = openDatabase(dir, openBunSqlite);
    try {
      expect(importJsonStores(db, dir, Date.now()).map(({ store }) => store)).toHaveLength(7);
      const moderation = new Moderation(db, Date.now());
      moderation.reload();
      expect(moderation.list(Date.now())).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe("frontfall-admin", () => {
  it("refuses to make a data.db of its own", () => {
    const run = admin("bans", "list");
    expect(run.status).toBe(1);
    expect(run.out).toContain("No data.db");
  });

  it("refuses a data.db from a newer release", () => {
    const db = openDatabase(dir, openBunSqlite);
    db.exec("PRAGMA user_version = 2");
    db.close();
    const run = admin("bans", "list");
    expect(run.status).toBe(1);
    expect(run.out).toContain("data.db is from a newer release (schema 2)");
  });

  it("bans, lists, lifts, lists reports and writes a backup, with no server running", async () => {
    // A server's first start, as in the container, makes data.db.
    const server = createGameServer({
      staticRoot: dir,
      version: "test",
      dataDir: dir,
      drainMs: 0,
      openSql: openBunSqlite,
    });
    await server.close();

    const added = admin("bans", "add", "203.0.113.7", "--days", "3", "--note", "spam");
    expect(added.status).toBe(0);
    expect(added.out).toContain('"note": "spam"');
    expect(added.out).toContain("no server answered");
    expect(admin("bans", "list").out).toContain("203.0.113.7");
    expect(admin("reports", "list").out).toContain('"reports": []');
    const file = join(dir, "copy.db");
    expect(admin("backup", file).status).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const copy = openBunSqlite(file);
    expect(copy.all("SELECT target FROM bans")).toEqual([{ target: "203.0.113.7" }]);
    copy.close();
    expect(admin("bans", "remove", "203.0.113.7").status).toBe(0);
    expect(admin("bans", "list").out).toContain('"bans": []');
    expect(admin("help").status).toBe(2);
  });

  it("has a running server read the list again and close what it bans", async () => {
    const server = createGameServer({
      staticRoot: dir,
      version: "test",
      dataDir: dir,
      drainMs: 0,
      openSql: openBunSqlite,
    });
    const { port } = await server.listen(0, "127.0.0.1");
    try {
      const run = Bun.spawn(["bun", ADMIN, "bans", "add", "198.51.100.4"], {
        env: { ...process.env, FRONTFALL_DATA: dir, PORT: String(port) },
        stdout: "pipe",
      });
      expect(await run.exited).toBe(0);
      expect(await new Response(run.stdout).text()).toContain("the server reads the list again");
      const answer = (await (
        await fetch(`http://127.0.0.1:${String(port)}/admin/bans`)
      ).json()) as {
        bans: { target: string }[];
      };
      expect(answer.bans.map((ban) => ban.target)).toEqual(["198.51.100.4"]);
    } finally {
      await server.close();
    }
  });
});
