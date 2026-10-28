import { TileKind } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { generateMap, type MapData } from "../src/game/maps.ts";
import {
  readReplayFile,
  replayFile,
  replayFileName,
  sameReplayMap,
} from "../src/game/replay-file.ts";
import { SoloGame, type SoloOptions } from "../src/game/solo-game.ts";

const options: SoloOptions = {
  map: "skirmish",
  seed: 5,
  bots: 3,
  difficulty: "normal",
  playerName: "Ada",
};

/** A generated map passed off as a published one, so that a record can pin it. */
function publishedMap(): MapData {
  return { ...generateMap(options.map), source: { format: 1, version: 1, sha256: "test" } };
}

/** A solo game played for `ticks` ticks, with a start and one attack from the player. */
function played(ticks: number, rules?: SoloOptions["rules"]): SoloGame {
  const map = publishedMap();
  const solo = new SoloGame({ ...options, rules }, map);
  const land = map.kinds.findIndex((kind) => kind !== TileKind.Water);
  solo.step([{ type: "spawn", tile: land }]);
  while (solo.game.phase === "spawn") solo.step([]);
  const target = map.kinds.findLastIndex((kind) => kind !== TileKind.Water);
  solo.step([{ type: "attack", target, troops: 100 }]);
  while (solo.game.tick < ticks) solo.step([]);
  return solo;
}

describe("replays (#50)", () => {
  it("needs the same map version as well as the same terrain", () => {
    const terrain = "a".repeat(64);
    expect(sameReplayMap({ version: 3, sha256: terrain }, { version: 3, sha256: terrain })).toBe(
      true,
    );
    // World v4 kept the terrain of v3 and added nations.
    expect(sameReplayMap({ version: 3, sha256: terrain }, { version: 4, sha256: terrain })).toBe(
      false,
    );
    expect(
      sameReplayMap({ version: 3, sha256: terrain }, { version: 3, sha256: "b".repeat(64) }),
    ).toBe(false);
    expect(sameReplayMap({ version: 3, sha256: terrain }, undefined)).toBe(false);
  });

  it("record a solo game and play it again to the same hash (R-FAIR-01)", () => {
    const solo = played(400);
    const record = solo.record();
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.ticks).toBe(400);
    expect(record.turns.map((turn) => turn.orders[0]?.order.type)).toEqual(["spawn", "attack"]);
    const replay = new SoloGame({ ...options, seed: 1, bots: 0, record }, publishedMap());
    let update = replay.replay(150);
    expect(update.tick).toBe(150);
    expect(update.replay).toEqual({ ticks: 400, expected: record.hash });
    update = replay.replay(1000);
    expect(update.tick).toBe(400);
    expect(update.replay?.hash).toBe(record.hash);
    expect(update.players.map((player) => player.name)).toEqual(
      solo.step([]).players.map((player) => player.name),
    );
  });

  it("record the special rules, and play the game again under them (R-MODE-08)", async () => {
    expect(played(50).record()?.rules).toBeUndefined();
    const solo = played(300, { capitals: true });
    expect(solo.game.rules.capitals).toBe(true);
    const record = solo.record();
    if (!record) throw new Error("no record");
    expect(record.rules).toEqual({ collapsingFronts: false, capitals: true });
    expect(await readReplayFile(await replayFile(record), "dev")).toEqual(record);
    // The record wins over the options of the page that watches it.
    const replay = new SoloGame(
      { ...options, rules: { collapsingFronts: false, capitals: false }, record },
      publishedMap(),
    );
    expect(replay.game.rules.capitals).toBe(true);
    expect(replay.replay(1000).replay?.hash).toBe(record.hash);
  });

  it("keeps nothing to record while watching, nor on a map with no file", () => {
    const solo = played(250);
    const record = solo.record();
    if (!record) throw new Error("no record");
    expect(new SoloGame({ ...options, record }, publishedMap()).record()).toBeUndefined();
    expect(new SoloGame(options, generateMap(options.map)).record()).toBeUndefined();
  });

  it("saves to a compressed file that reads back the same, on the same build only", async () => {
    const record = played(250).record();
    if (!record) throw new Error("no record");
    const file = await replayFile(record);
    expect(file.size).toBeLessThan(JSON.stringify(record).length);
    expect(await readReplayFile(file, "dev")).toEqual(record);
    expect(await readReplayFile(file, record.build.build)).toEqual(record);
    expect(await readReplayFile(file, "another-build")).toBe("otherBuild");
    expect(await readReplayFile(new Blob(["not a replay"]), "dev")).toBe("unreadable");
    expect(replayFileName(record, new Date("2026-10-24T12:00:00Z"))).toBe(
      "frontfall-skirmish-2026-10-24.ffr",
    );
  });

  it("keeps 30 minutes of eight busy players under 1 MB", async () => {
    const record = played(250).record();
    if (!record) throw new Error("no record");
    // An order from each of eight players every second, for 30 minutes.
    const turns = [];
    for (let tick = 0; tick < 30 * 60 * 10; tick += 10) {
      turns.push({
        tick,
        orders: Array.from({ length: 8 }, (_, i) => ({
          player: i + 1,
          order: {
            type: "attack" as const,
            target: (tick * 7919 + i * 104_729) % 2_097_152,
            troops: 12_345 + tick,
          },
        })),
      });
    }
    const file = await replayFile({ ...record, ticks: 18_000, turns });
    expect(file.size).toBeLessThan(1_000_000);
  });
});
