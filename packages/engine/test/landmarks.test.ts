import { describe, expect, it } from "vitest";
import { captureCost } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import { goldEarning, playerGrowth, populationCap } from "../src/economy.ts";
import type { Order, Player } from "../src/game.ts";
import {
  guardedByLandmark,
  heldLandmarks,
  landmarkFortressRadius,
  landmarkShieldRadius,
  type Landmark,
  type LandmarkEffect,
} from "../src/landmarks.ts";
import { loadMap } from "../src/map/load-map.ts";
import { encodeMapFile, TILE_LAND } from "../src/map/map-file.ts";
import { sha256Hex } from "../src/map/sha256.ts";
import { MissileSize } from "../src/missiles.ts";
import { StructureKind } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  desertionBasisPoints: 0,
  spawnPhaseTicks: 0,
  buildTicks: 1,
  longBuildTicks: 2,
  siloCost: 1000,
  missileCost: 500,
  missileRadius: 2,
  missileSpeed: 5,
  landmarkFortressRadius: 4,
  landmarkShieldRadius: 6,
};

const grid = new WorldGrid(60, 20, { wrapsX: false });
const LANDMARK = grid.index(30, 10);

/**
 * A 60 × 20 plain with one landmark in its middle: Ada holds the columns
 * west of x = 20, Bea those from 40, and nobody the middle.
 */
function newGame(effect: LandmarkEffect, overrides: Partial<Balance> = {}) {
  const landmarks: Landmark[] = [{ id: "tower", tile: LANDMARK, effect }];
  const game = createGame({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains), landmarks),
    seed: 4,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    if (x < 20) game.territory.setOwner(tile, 1);
    else if (x >= 40) game.territory.setOwner(tile, 2);
  }
  for (const player of game.players()) {
    player.gold = 100_000;
    player.troops = 20_000;
  }
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  /** Gives Ada the landmark and the land between it and her own. */
  const take = () => {
    for (let tile = 0; tile < grid.size; tile++) {
      if (grid.x(tile) >= 20 && grid.x(tile) <= 30) game.territory.setOwner(tile, 1);
    }
  };
  return { game, step, ada, bea, take };
}

describe("landmarks (R-LAND)", () => {
  it("belong to whoever holds their tile, and to nobody before", () => {
    const { game, ada, take } = newGame("gold");
    expect(heldLandmarks(game, ada.id, "gold")).toBe(0);
    take();
    expect(heldLandmarks(game, ada.id, "gold")).toBe(1);
    expect(heldLandmarks(game, ada.id, "growth")).toBe(0);
    expect(heldLandmarks(game, NEUTRAL, "gold")).toBe(0);
  });

  it("raise the gold of a gold landmark's holder by B-LANDMARK-GOLD", () => {
    const { game, ada, take } = newGame("gold");
    const before = goldEarning(game, ada);
    take();
    expect(goldEarning(game, ada)).toBe(Math.floor((before * 120) / 100));
  });

  it("speed up the growth of a growth landmark's holder by B-LANDMARK-GROWTH, never past the cap", () => {
    const { game, ada, take } = newGame("growth", { growthBasisPoints: 2000 });
    ada.troops = 1000;
    const plain = playerGrowth(game, ada, populationCap(game, ada));
    take();
    const cap = populationCap(game, ada);
    expect(playerGrowth(game, ada, cap)).toBeGreaterThan(plain);
    ada.troops = cap - 1;
    expect(playerGrowth(game, ada, cap)).toBe(1);
  });

  it("make the land around a fortress landmark cost B-LANDMARK-FORTRESS to take", () => {
    const { game, ada, bea, take } = newGame("fortress");
    take();
    const near = grid.index(28, 10);
    const far = grid.index(10, 10);
    expect(guardedByLandmark(game, near, ada.id)).toBe(true);
    expect(guardedByLandmark(game, far, ada.id)).toBe(false);
    expect(guardedByLandmark(game, near, bea.id)).toBe(false);
    expect(captureCost(game, near, ada, bea.id)).toBe(captureCost(game, far, ada, bea.id) * 2);
    expect(landmarkFortressRadius(game)).toBe(4);
  });

  it("make every tile cheaper for an assault landmark's holder by B-LANDMARK-ASSAULT", () => {
    const { game, ada, bea, take } = newGame("assault", { neutralCost: 100 });
    const tile = grid.index(45, 10);
    const usual = captureCost(game, tile, bea, ada.id);
    take();
    expect(captureCost(game, tile, bea, ada.id)).toBe(Math.floor((usual * 90) / 100));
    // Only the holder's attacks are cheaper.
    const own = grid.index(5, 10);
    expect(captureCost(game, own, ada, bea.id)).toBe(captureCost(game, own, ada, NEUTRAL));
  });

  it("tell every player when a landmark changes hands (R-LAND-03)", () => {
    const { game, step, ada, bea, take } = newGame("gold");
    step();
    take();
    step();
    expect(game.diplomacyEvents.at(-1)).toMatchObject({
      type: "landmark",
      a: ada.id,
      b: NEUTRAL,
      landmark: 0,
    });
    game.territory.setOwner(LANDMARK, bea.id);
    step();
    expect(game.diplomacyEvents.at(-1)).toMatchObject({ type: "landmark", a: bea.id, b: ada.id });
    const count = game.diplomacyEvents.length;
    step();
    expect(game.diplomacyEvents.length).toBe(count);
  });

  describe("a shield landmark", () => {
    /** Bea's silo at the east end fires at Ada's land, past the landmark. */
    function shot(chance: number, holder: "ada" | "bea") {
      const setup = newGame("shield", { landmarkShieldChancePercent: chance });
      const { game, step, ada, bea, take } = setup;
      if (holder === "ada") take();
      else game.territory.setOwner(LANDMARK, bea.id);
      const silo = grid.index(55, 10);
      step([{ player: 2, order: { type: "build", structure: StructureKind.Silo, tile: silo } }]);
      for (let i = 0; i < 3; i++) step();
      const target = grid.index(5, 10);
      step([{ player: 2, order: { type: "missile", target, size: MissileSize.Light } }]);
      for (let i = 0; i < 20 && game.missiles.length > 0; i++) step();
      return { game, target, ada, bea };
    }

    it("stops a missile flying near it at B-LANDMARK-SHIELD-CHANCE", () => {
      const { game, target, ada, bea } = shot(100, "ada");
      expect(game.territory.ownerOf(target)).toBe(ada.id);
      expect(game.diplomacyEvents.at(-1)).toMatchObject({ type: "stopped", a: ada.id, b: bea.id });
      expect(landmarkShieldRadius(game)).toBe(6);
    });

    it("lets it through at a chance of 0", () => {
      const { game, target } = shot(0, "ada");
      expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
    });

    it("never stops its own holder's missiles", () => {
      const { game, target } = shot(100, "bea");
      expect(game.territory.ownerOf(target)).toBe(NEUTRAL);
    });
  });

  it("are read from a map's manifest, on land a player can own", () => {
    const tiles = new Uint8Array(8).fill(TILE_LAND);
    tiles[0] = 0;
    const bytes = encodeMapFile({ width: 4, height: 2, wrapsX: false, tiles });
    const description = {
      width: 4,
      height: 2,
      topology: "flat" as const,
      terrain: { sha256: sha256Hex(bytes) },
    };
    const with_ = (landmarks: { id: string; tile: number; effect: string }[]) =>
      loadMap(bytes, { ...description, landmarks }).terrain.landmarks;
    expect(with_([{ id: "tower", tile: 5, effect: "trade" }])).toEqual([
      { id: "tower", tile: 5, effect: "trade" },
    ]);
    expect(loadMap(bytes, description).terrain.landmarks).toEqual([]);
    expect(() => with_([{ id: "a", tile: 0, effect: "gold" }])).toThrow("not on land");
    expect(() => with_([{ id: "a", tile: 5, effect: "magic" }])).toThrow("no effect");
  });
});
