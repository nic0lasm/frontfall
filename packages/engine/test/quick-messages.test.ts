import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import { DiplomacyError } from "../src/diplomacy.ts";
import type { Order, Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { QUICK_MESSAGES, QUICK_MESSAGE_TICKS, QuickError } from "../src/quick-messages.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

function newGame(spawnPhaseTicks = 0) {
  const grid = new WorldGrid(16, 8, { wrapsX: false });
  const game = createGame({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 2,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks },
  });
  // Both players hold land, or they would leave the game on the first tick.
  for (let tile = 0; tile < grid.size; tile++) game.territory.setOwner(tile, tile % 16 < 8 ? 1 : 2);
  return { game, ada: game.player(1) as Player };
}

const quick = (target: number, phrase: number): Order => ({ type: "quick", target, phrase });

describe("quick messages (R-DIPLO-07)", () => {
  it("reach the event log with their number, and leave nothing but the wait, which the next message replaces", () => {
    const { game, ada } = newGame();
    const other = newGame().game;
    expect(game.step({ tick: 0, orders: [{ player: 1, order: quick(2, 3) }] })).toBe(1);
    other.step({ tick: 0, orders: [] });
    expect(game.diplomacyEvents).toContainEqual({ tick: 0, type: "quick", a: 1, b: 2, phrase: 3 });
    // One message every QUICK_MESSAGE_TICKS, to anyone.
    expect(orderError(game, ada, quick(2, 0))).toBe(QuickError.Cooldown);
    expect(game.hash()).not.toBe(other.hash());
    while (game.tick < QUICK_MESSAGE_TICKS) {
      game.step({ tick: game.tick, orders: [] });
      other.step({ tick: other.tick, orders: [] });
    }
    expect(orderError(game, ada, quick(2, 0))).toBeUndefined();
    // The wait that is over stays in the list, and in the state hash, until the sender's next message.
    expect(game.hash()).not.toBe(other.hash());
    const next = { tick: game.tick, orders: [{ player: 1, order: quick(2, 0) }] };
    expect(game.step(next)).toBe(1);
    expect(other.step(next)).toBe(1);
    expect(game.hash()).toBe(other.hash());
  });

  it("are one of the presets, to another player still in the game, once the play phase starts", () => {
    const { game, ada } = newGame();
    expect(orderError(game, ada, quick(2, QUICK_MESSAGES - 1))).toBeUndefined();
    expect(orderError(game, ada, quick(2, QUICK_MESSAGES))).toBe(QuickError.Phrase);
    expect(orderError(game, ada, quick(1, 0))).toBe(QuickError.Self);
    expect(orderError(game, ada, quick(7, 0))).toBe(DiplomacyError.Player);
    expect(orderError(game, ada, quick(2, -1))).toBe(QuickError.Phrase);
    expect(orderError(game, ada, quick(2, 1.5))).toBe(QuickError.Phrase);
    (game.player(2) as Player).alive = false;
    expect(orderError(game, ada, quick(2, 0))).toBe(DiplomacyError.Player);
    const early = newGame(10);
    expect(orderError(early.game, early.ada, quick(2, 0))).toBe(QuickError.Early);
  });
});
