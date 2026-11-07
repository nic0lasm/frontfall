import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdmin } from "../src/admin-command.ts";
import { Moderation } from "../src/moderation.ts";
import { openNodeSqlite } from "../src/sql/node-sqlite.ts";
import { tempDatabase, type TempDatabase } from "./support/database.ts";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let data: TempDatabase;
let printed: string[];
let reloads: number;

beforeEach(() => {
  data = tempDatabase("frontfall-admin-");
  printed = [];
  reloads = 0;
});

afterEach(() => {
  data.remove();
});

function admin(...args: string[]): Promise<number> {
  return runAdmin(args, {
    db: data.db,
    now: NOW,
    print: (text) => printed.push(text),
    reload: () => {
      reloads++;
      return Promise.resolve("reloaded");
    },
  });
}

describe("frontfall-admin", () => {
  it("adds, lists and removes bans, and has the server read them again", async () => {
    expect(await admin("bans", "add", "203.0.113.7", "--days", "7", "--note", "insults")).toBe(0);
    expect(JSON.parse(printed[0] ?? "")).toEqual({
      target: "203.0.113.7",
      until: new Date(NOW + 7 * DAY).toISOString(),
      note: "insults",
    });
    expect(await admin("bans", "add", "2001:db8:0:1::5")).toBe(0);
    expect(reloads).toBe(2);
    printed = [];
    expect(await admin("bans", "list")).toBe(0);
    expect(
      (JSON.parse(printed[0] ?? "") as { bans: { target: string }[] }).bans.map((b) => b.target),
    ).toEqual(["203.0.113.7", "2001:db8:0:1::/64"]);
    // The server, which reads data.db, sees the same list.
    const server = new Moderation(data.reopen(), NOW);
    server.reload(NOW);
    expect(server.banned("203.0.113.7", NOW)).toMatchObject({ note: "insults" });

    expect(await admin("bans", "remove", "203.0.113.7")).toBe(0);
    expect(await admin("bans", "remove", "203.0.113.7")).toBe(1);
    expect(printed.at(-1)).toBe("no ban of 203.0.113.7");
    server.reload(NOW);
    expect(server.banned("203.0.113.7", NOW)).toBeUndefined();
  });

  it("refuses a target that is not one, and options that do not read", async () => {
    expect(await admin("bans", "add", "nobody")).toBe(1);
    expect(await admin("bans", "add", "203.0.113.7", "--days", "-1")).toBe(2);
    expect(await admin("bans", "add", "203.0.113.7", "--forever")).toBe(2);
    expect(await admin("bans")).toBe(2);
    expect(await admin("nothing")).toBe(2);
    expect(await admin("bans", "list", "extra", "more")).toBe(2);
    expect(printed.at(-1)).toContain("Usage: frontfall-admin");
    expect(reloads).toBe(0);
  });

  it("lists the reports of the last days", async () => {
    const moderation = new Moderation(data.db, NOW);
    const report = { game: "abcdefgh", reason: "abuse" as const, player: 2, name: "Troll" };
    moderation.report(report, "198.51.100.1", "203.0.113.7", NOW - 3 * DAY);
    moderation.report({ ...report, player: 3 }, "198.51.100.2", "203.0.113.8", NOW - DAY);
    moderation.flush();
    expect(await admin("reports", "list", "--days", "2")).toBe(0);
    const { reports, targets } = JSON.parse(printed[0] ?? "") as {
      reports: unknown[];
      targets: unknown[];
    };
    expect(reports).toHaveLength(1);
    expect(targets).toHaveLength(1);
    expect(printed[0]).not.toContain("198.51.100");
  });

  it("writes a consistent copy of data.db, readable by its owner only, and never over a file", async () => {
    data.db.run("INSERT INTO bans (target, until, note) VALUES ('203.0.113.7', NULL, NULL)");
    const file = join(data.dir, "backup.db");
    expect(await admin("backup", file)).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const restored = openNodeSqlite(file);
    expect(restored.all("SELECT target FROM bans")).toEqual([{ target: "203.0.113.7" }]);
    restored.close();
    expect(await admin("backup", file)).toBe(1);
    expect(printed.at(-1)).toMatch(/already exists/);
    expect(existsSync(`${file}-wal`)).toBe(false);
  });
});
