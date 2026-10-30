import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import {
  DESYNC_REPORT_VERSION,
  DesyncReportError,
  readDesyncReport,
  replayDesyncReport,
  type DesyncReport,
} from "../src/desync-report.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const terrain = new Terrain(new WorldGrid(32, 16), new Uint8Array(32 * 16).fill(TileKind.Plains));

const report: DesyncReport = {
  version: DESYNC_REPORT_VERSION,
  build: { release: "test", protocol: 4 },
  map: { id: "plain", format: 1, version: 1, sha256: "" },
  seed: 3,
  balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 5 },
  players: [
    { id: 1, name: "Ada" },
    { id: 2, name: "Bot" },
    { id: 3, name: "Norland", start: 200 },
  ],
  bots: { ids: [2], difficulty: "easy" },
  nations: [3],
  disabled: 8,
  you: 1,
  ticks: 60,
  turns: [
    { tick: 0, orders: [{ player: 1, order: { type: "spawn", tile: 40 } }] },
    { tick: 10, orders: [{ player: 1, order: { type: "attack", target: 300, troops: 200 } }] },
    {
      tick: 20,
      orders: [
        { player: 1, order: { type: "build", structure: 0, tile: 40 } },
        { player: 1, order: { type: "demolish", tile: 40 } },
      ],
    },
    { tick: 30, orders: [{ player: 1, order: { type: "gift", target: 2, troops: 10, gold: 0 } }] },
    { tick: 40, orders: [{ player: 1, order: { type: "quick", target: 2, phrase: 5 } }] },
  ],
  hashes: [],
};

describe("desync reports", () => {
  it("survive a round trip through JSON", () => {
    expect(readDesyncReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("replay the same hashes every time, and find where two clients parted", () => {
    const first = replayDesyncReport(report, terrain);
    expect(first).toEqual({ ticks: 60, firstLocalMismatch: undefined, firstDesync: undefined });
    // Hashes come from a replay of the report itself; the "others" disagree from tick 39 on.
    const local = [19, 39, 59].map(hashAt);
    const hashes = [19, 39, 59].map((tick, i) => ({
      tick,
      local: local[i] as number,
      expected: tick < 39 ? (local[i] as number) : 0,
    }));
    expect(replayDesyncReport({ ...report, hashes }, terrain)).toEqual({
      ticks: 60,
      firstLocalMismatch: undefined,
      firstDesync: { tick: 39, local: local[1], expected: 0 },
    });
  });

  it("refuse other versions and malformed fields", () => {
    const broken = (patch: Record<string, unknown>) => () =>
      readDesyncReport({ ...JSON.parse(JSON.stringify(report)), ...patch });
    expect(broken({ version: 1 })).toThrow(/unsupported report version 1/);
    expect(broken({ seed: 1.5 })).toThrow(DesyncReportError);
    expect(broken({ balance: { ...DEFAULT_BALANCE, popLand: "40" } })).toThrow(/popLand/);
    const before: Record<string, unknown> = { ...DEFAULT_BALANCE, popPerTile: 40 };
    delete before.popBase;
    expect(broken({ balance: before })).toThrow(/economy of 0.9.4/);
    expect(broken({ bots: { ids: [2], difficulty: "brutal" } })).toThrow(/brutal/);
    expect(broken({ nations: ["x"] })).toThrow(/nation id/);
    expect(broken({ disabled: 64 })).toThrow(/disabled/);
    expect(broken({ players: [{ id: 3, name: "Norland", start: 1.5 }] })).toThrow(/player start/);
    expect(
      broken({ turns: [{ tick: 0, orders: [{ player: 1, order: { type: "launch" } }] }] }),
    ).toThrow(/launch/);
  });
});

/** The client's hash after `tick`: a replay that stops there and reports a mismatch against 0. */
function hashAt(tick: number): number {
  const run = replayDesyncReport(
    { ...report, ticks: tick + 1, hashes: [{ tick, local: 0, expected: null }] },
    terrain,
  );
  return run.firstLocalMismatch?.replay ?? 0;
}
