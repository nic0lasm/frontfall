import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ErrorReport } from "@frontfall/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClientErrors,
  clientErrorsFile,
  groupId,
  loadClientErrors,
  MAX_GROUPS,
  saveClientErrors,
} from "../src/client-errors.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12);

const ERROR: ErrorReport = {
  kind: "error",
  release: "0.8.0",
  type: "exception",
  message: "x is not a function",
  where: "main-Ab12.js:1:2045",
  browser: "chromium",
  device: "desktop",
  screen: "online",
};

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("ClientErrors", () => {
  it("groups errors by kind, message and place, and counts what goes with them", () => {
    const errors = new ClientErrors();
    const id = errors.record(ERROR, NOW);
    expect(errors.record({ ...ERROR, release: "0.9.0", browser: "safari" }, NOW + DAY)).toBe(id);
    expect(errors.record({ ...ERROR, type: "rejection" }, NOW)).not.toBe(id);
    // Numbers are scrubbed: the same error with another index is the same group.
    expect(errors.record({ ...ERROR, message: "x is not a function 12" }, NOW)).not.toBe(id);
    expect(errors.record({ ...ERROR, message: "x is not a function 13" }, NOW)).toBe(
      errors.record({ ...ERROR, message: "x is not a function 99" }, NOW),
    );
    const groups = errors.read(NOW + DAY, 7).groups;
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.id === id)).toMatchObject({
      id,
      recent: 2,
      total: 2,
      first: "2026-10-29",
      last: "2026-10-30",
      releases: { "0.8.0": 1, "0.9.0": 1 },
      browsers: { chromium: 1, safari: 1 },
      screens: { online: 2 },
    });
  });

  it("keeps apart the errors from code outside the game's own, by kind", () => {
    const errors = new ClientErrors();
    const bare: ErrorReport = {
      kind: "error",
      release: "1.0.0",
      type: "exception",
      browser: "chromium",
      device: "desktop",
      screen: "menu",
    };
    const own = errors.record(bare, NOW);
    const hidden = errors.record({ ...bare, from: "hidden" }, NOW);
    const extension = errors.record({ ...bare, from: "extension" }, NOW);
    expect(new Set([own, hidden, extension]).size).toBe(3);
    // Without an origin the id is what it always was, so groups kept before keep theirs.
    expect(own).toBe(groupId("exception", "", ""));
    expect(errors.record({ ...bare, from: "hidden", browser: "safari" }, NOW)).toBe(hidden);
    const groups = errors.read(NOW, 1).groups;
    expect(groups.find((group) => group.id === hidden)).toMatchObject({
      from: "hidden",
      recent: 2,
      browsers: { chromium: 1, safari: 1 },
    });
    expect(groups.find((group) => group.id === own)).toMatchObject({ from: "" });
  });

  it("reads groups kept before the origin existed", () => {
    const errors = new ClientErrors();
    const stored = JSON.stringify({
      version: 1,
      groups: {
        abc123def456: {
          type: "exception",
          message: "",
          where: "",
          first: "2026-10-29",
          last: "2026-10-29",
          days: { "2026-10-29": 4 },
          releases: { "0.9.5": 4 },
          browsers: { safari: 4 },
          devices: { phone: 4 },
          screens: { menu: 4 },
        },
      },
    });
    expect(errors.restore(stored)).toBe(true);
    expect(errors.read(NOW, 7).groups[0]).toMatchObject({ id: "abc123def456", from: "" });
  });

  it("counts reports without the newer fields as unknown", () => {
    const errors = new ClientErrors();
    errors.record({ kind: "error", release: "0.8.0", type: "webgl" }, NOW);
    expect(errors.read(NOW, 1).groups[0]).toMatchObject({
      message: "",
      where: "",
      browsers: { unknown: 1 },
    });
  });

  it("reads the days asked for and forgets those past thirty", () => {
    const errors = new ClientErrors();
    errors.record(ERROR, NOW - 10 * DAY);
    errors.record({ ...ERROR, type: "worker" }, NOW);
    expect(errors.read(NOW, 7).groups.map((group) => group.type)).toEqual(["worker"]);
    expect(errors.read(NOW, 30).groups).toHaveLength(2);
    expect(errors.read(NOW + 25 * DAY, 30).groups.map((group) => group.type)).toEqual(["worker"]);
  });

  it("holds a bounded number of groups, dropping the one seen longest ago", () => {
    const errors = new ClientErrors();
    errors.record({ ...ERROR, where: "old.js:1:1" }, NOW - DAY);
    for (let index = 0; index < MAX_GROUPS; index++) {
      errors.record({ ...ERROR, where: `f${String(index)}.js:1:1` }, NOW);
    }
    expect(errors.size).toBe(MAX_GROUPS);
    expect(errors.read(NOW, 30).groups.some((group) => group.where === "old.js:1:1")).toBe(false);
  });

  it("counts a value named like a property of every object as any other", () => {
    const errors = new ClientErrors();
    errors.record({ ...ERROR, release: "constructor" }, NOW);
    errors.record({ ...ERROR, release: "constructor" }, NOW);
    expect(errors.read(NOW, 1).groups[0]?.releases).toEqual({ constructor: 2 });
    const back = new ClientErrors();
    expect(back.restore(errors.serialize(NOW))).toBe(true);
  });

  it("counts every day of an error that keeps coming back, and forgets each in turn", () => {
    const errors = new ClientErrors();
    for (let day = 0; day < 20; day++) errors.record(ERROR, NOW + day * DAY);
    expect(errors.read(NOW + 19 * DAY, 7).groups[0]?.recent).toBe(7);
    expect(errors.read(NOW + 19 * DAY, 30).groups[0]?.total).toBe(20);
    expect(errors.read(NOW + 40 * DAY, 30).groups[0]?.total).toBe(9);
  });

  it("counts a field's rarer values together past a dozen", () => {
    const errors = new ClientErrors();
    for (let index = 0; index < 20; index++) {
      errors.record({ ...ERROR, release: `0.${String(index)}.0` }, NOW);
    }
    const releases = errors.read(NOW, 1).groups[0]?.releases ?? {};
    expect(Object.keys(releases)).toHaveLength(13);
    expect(releases.other).toBe(8);
  });

  it("keeps the groups in a private file, and sets a damaged one aside", () => {
    dir = mkdtempSync(join(tmpdir(), "frontfall-errors-"));
    const file = clientErrorsFile(dir);
    const errors = new ClientErrors();
    errors.record(ERROR, NOW);
    saveClientErrors(errors, file, NOW);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const back = new ClientErrors();
    expect(loadClientErrors(back, file)).toBeUndefined();
    expect(back.read(NOW, 1).groups).toHaveLength(1);
    writeFileSync(file, "{");
    expect(loadClientErrors(new ClientErrors(), file)?.message).toContain("broken");
    expect(readFileSync(`${file}.broken`, "utf8")).toBe("{");
    expect(loadClientErrors(new ClientErrors(), join(dir, "none.json"))).toBeUndefined();
  });
});
