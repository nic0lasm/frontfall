import { describe, expect, it } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { installNations, NATION_DIFFICULTIES, type BotDifficulty } from "../src/bots/index.ts";
import { installDiplomacy } from "../src/diplomacy.ts";
import { Game, type Order } from "../src/game.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { installGifts } from "../src/gifts.ts";
import { installQuickMessages } from "../src/quick-messages.ts";
import { installStructures } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

/** Ada (player 2) holds 8 columns beside the nation's 20 (player 1); the rest is free. */
function strip(difficulty: BotDifficulty) {
  const grid = new WorldGrid(60, 3, { wrapsX: false });
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Norland" },
      { id: 2, name: "Ada" },
    ],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 0, attackSpeedDivisor: 1000 },
  });
  installAttacks(game);
  installStructures(game);
  installDiplomacy(game);
  installGifts(game);
  installQuickMessages(game);
  installNations(game, [1], difficulty, 0);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    game.territory.setOwner(tile, x >= 12 && x < 20 ? 2 : x >= 20 && x < 40 ? 1 : NEUTRAL);
  }
  const applied: { player: number; order: Order }[] = [];
  game.onApplied((_, player, order) => applied.push({ player: player.id, order }));
  return { game, applied };
}

describe("nations courting players (B-NATION-COURT-PLAYERS)", () => {
  const offered = (applied: { player: number; order: Order }[]) =>
    applied.some((a) => a.player === 1 && a.order.type === "ally" && a.order.target === 2);

  it("offers an easy alliance to a smaller neighbour who has not attacked, not before the grace", () => {
    const { game, applied } = strip("easy");
    const from = NATION_DIFFICULTIES.easy.courtPlayersSeconds * game.balance.ticksPerSecond;
    for (let i = 0; i < from - 1; i++) game.step({ tick: game.tick, orders: [] });
    expect(offered(applied)).toBe(false);
    for (let i = 0; i < 400; i++) game.step({ tick: game.tick, orders: [] });
    expect(offered(applied)).toBe(true);
  });

  it("never does at normal and hard", () => {
    for (const difficulty of ["normal", "hard"] as const) {
      const { game, applied } = strip(difficulty);
      for (let i = 0; i < 4000; i++) game.step({ tick: game.tick, orders: [] });
      expect(offered(applied)).toBe(false);
    }
  });
});
