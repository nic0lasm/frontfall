import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BALANCE,
  loadMap,
  readDesyncReport,
  replayDesyncReport,
  type MapDescription,
} from "@frontfall/engine";

const replays = new URL("../../packages/engine/test/replays/", import.meta.url);
const maps = new URL("../../apps/client/public/maps/", import.meta.url);

/**
 * Golden replays (R-FAIR-01): scripted games on published maps whose hashes
 * every 50 ticks are pinned. They are played with today's DEFAULT_BALANCE, so
 * a change to any rule or balance value shows up as the first tick where the
 * game parts from the reference. `bun run golden` writes them again when that
 * change is meant; `bun run determinism` plays them in a browser too.
 */
describe("golden replays", () => {
  const files = readdirSync(replays).filter((file) => file.endsWith(".json"));

  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`replay ${file} to its pinned hashes`, () => {
      const report = readDesyncReport(JSON.parse(readFileSync(new URL(file, replays), "utf8")));
      const manifest = JSON.parse(
        readFileSync(new URL(`${report.map.id}.json`, maps), "utf8"),
      ) as MapDescription;
      expect(manifest.terrain.sha256, `${file} was recorded on another ${report.map.id} map`).toBe(
        report.map.sha256,
      );
      const { terrain } = loadMap(readFileSync(new URL(`${report.map.id}.bin`, maps)), manifest);
      const result = replayDesyncReport({ ...report, balance: DEFAULT_BALANCE }, terrain);
      const mismatch = result.firstLocalMismatch;
      expect(
        mismatch,
        mismatch &&
          `${file} parts from its golden hashes at tick ${String(mismatch.tick)}; ` +
            "if the change is meant to alter games, run bun run golden and commit the replays",
      ).toBeUndefined();
      expect(result.ticks).toBe(report.ticks);
    }, 600_000);
  }
});
