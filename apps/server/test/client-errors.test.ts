import type { ErrorReport } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { readDocument, writeDocument } from "../src/database.ts";
import {
  ClientErrors,
  loadClientErrors,
  MAX_GROUPS,
  saveClientErrors,
} from "../src/client-errors.ts";
import { tempDatabase } from "./support/database.ts";

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

  it("keeps the groups in data.db, and sets aside groups that do not read", () => {
    const data = tempDatabase("frontfall-errors-");
    try {
      const errors = new ClientErrors();
      errors.record(ERROR, NOW);
      saveClientErrors(errors, data.db, NOW);
      const back = new ClientErrors();
      expect(loadClientErrors(back, data.reopen(), NOW)).toBeUndefined();
      expect(back.read(NOW, 1).groups).toHaveLength(1);
      writeDocument(data.db, "errors", "{");
      expect(loadClientErrors(new ClientErrors(), data.db, NOW)?.message).toContain("broken");
      expect(readDocument(data.db, `errors.broken-${String(NOW)}`)).toBe("{");
      expect(loadClientErrors(new ClientErrors(), data.db, NOW)).toBeUndefined();
    } finally {
      data.remove();
    }
  });
});
