import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGame,
  DEFAULT_BALANCE,
  DESYNC_REPORT_VERSION,
  installBots,
  loadMap,
  type DesyncReport,
  type MapDescription,
  type Turn,
} from "@frontfall/engine";
import { afterAll, describe, expect, it, vi } from "vitest";
import { replay } from "../sim/replay.ts";

const maps = new URL("../../apps/client/public/maps/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("europe.json", maps), "utf8"),
) as MapDescription & {
  format: number;
  version: number;
};
const { terrain } = loadMap(readFileSync(new URL("europe.bin", maps)), manifest);
const dir = mkdtempSync(join(tmpdir(), "frontfall-replay-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Plays 400 ticks of Europe as a client would, with a few orders of its own, and writes the report. */
function record(): DesyncReport {
  const players = [1, 2, 3, 4].map((id) => ({ id, name: `P${String(id)}` }));
  const game = createGame({ terrain, seed: 9, players, balance: DEFAULT_BALANCE });
  installBots(game, [2, 3, 4], "normal");
  let land = 0;
  while (!terrain.isOwnable(land)) land++;
  const turns: Turn[] = [];
  const hashes: DesyncReport["hashes"] = [];
  while (game.tick < 400) {
    const tick = game.tick;
    const turn: Turn = {
      tick,
      orders: tick === 0 ? [{ player: 1, order: { type: "spawn", tile: land } }] : [],
    };
    if (turn.orders.length > 0) turns.push(turn);
    game.step(turn);
    if (tick % 50 === 49) hashes.push({ tick, local: game.hash(), expected: game.hash() });
  }
  return {
    version: DESYNC_REPORT_VERSION,
    build: { release: "test", protocol: 4 },
    map: {
      id: "europe",
      format: manifest.format,
      version: manifest.version,
      sha256: manifest.terrain.sha256,
    },
    seed: 9,
    balance: DEFAULT_BALANCE,
    players,
    bots: { ids: [2, 3, 4], difficulty: "normal" },
    you: 1,
    ticks: game.tick,
    turns,
    hashes,
  };
}

const report = record();

function run(changed: DesyncReport) {
  const path = join(dir, `${String(Math.random()).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(changed));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const code = replay(path);
  const out = [...log.mock.calls, ...error.mock.calls].map((args) => args.join(" ")).join("\n");
  log.mockRestore();
  error.mockRestore();
  return { code, out };
}

describe("bun run sim --replay", () => {
  it("plays a report back to the client's own hashes", () => {
    const { code, out } = run(report);
    expect(code).toBe(0);
    expect(out).toContain("no desync");
    expect(out).toContain("matches the client's hashes over 400 ticks");
  });

  it("names the first tick where the client parted from the others", () => {
    const hashes = report.hashes.map((entry, i) =>
      i >= 3 ? { ...entry, expected: (entry.local + 1) >>> 0 } : entry,
    );
    const { code, out } = run({ ...report, hashes });
    expect(code).toBe(0);
    expect(out).toContain(`first desync at tick ${String(report.hashes[3]?.tick)}`);
  });

  it("fails when the replay does not give the client's hashes back", () => {
    const hashes = report.hashes.map((entry, i) =>
      i === 5 ? { ...entry, local: (entry.local + 1) >>> 0 } : entry,
    );
    const { code, out } = run({ ...report, hashes });
    expect(code).toBe(1);
    expect(out).toContain(`parts from the client at tick ${String(report.hashes[5]?.tick)}`);
  });

  it("refuses a report written on another version of the map", () => {
    const { code, out } = run({ ...report, map: { ...report.map, sha256: "0".repeat(64) } });
    expect(code).toBe(1);
    expect(out).toContain("not the one the report was written on");
  });

  it("refuses a report of another format version", () => {
    for (const version of [1, 2]) {
      expect(() => run({ ...report, version: version as typeof DESYNC_REPORT_VERSION })).toThrow(
        `unsupported report version ${String(version)}`,
      );
    }
  });
});
