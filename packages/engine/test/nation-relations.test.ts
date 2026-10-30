import { describe, expect, it } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { installNations, nationMood } from "../src/bots/index.ts";
import { Phrase } from "../src/bots/relations.ts";
import { installDiplomacy } from "../src/diplomacy.ts";
import { populationCap } from "../src/economy.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { installGifts } from "../src/gifts.ts";
import { installQuickMessages } from "../src/quick-messages.ts";
import { installStructures } from "../src/structures.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

/**
 * A strip of 60 x 3 plains, no wrap: Ada holds columns 0 to 19, the nation
 * (player 1) 20 to 39 and Bea 40 to 59, at hard, past its grace.
 */
function strip() {
  const grid = new WorldGrid(60, 3, { wrapsX: false });
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Norland" },
      { id: 2, name: "Ada" },
      { id: 3, name: "Bea" },
    ],
    balance: {
      ...DEFAULT_BALANCE,
      spawnPhaseTicks: 0,
      attackSpeedDivisor: 1000,
      encircleMaxTiles: 1,
      // Caps small enough for the few troops the tests hand out: 4834 for 60 tiles.
      popBase: 2500,
    },
  });
  installAttacks(game);
  installStructures(game);
  installDiplomacy(game);
  installGifts(game);
  installQuickMessages(game);
  installNations(game, [1], "hard", 0);
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    game.territory.setOwner(tile, x < 20 ? 2 : x < 40 ? 1 : 3);
  }
  const nation = game.player(1) as Player;
  const ada = game.player(2) as Player;
  const bea = game.player(3) as Player;
  nation.start = grid.index(30, 1);
  const messages: { from: number; to: number; phrase: number }[] = [];
  const applied: { player: number; order: Order }[] = [];
  game.onApplied((_, player, order) => {
    applied.push({ player: player.id, order });
    if (order.type === "quick") {
      messages.push({ from: player.id, to: order.target, phrase: order.phrase });
    }
  });
  const run = (ticks: number, orders: { player: number; order: Order }[] = []) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: i === 0 ? orders : [] });
  };
  const seconds = (count: number) => count * game.balance.ticksPerSecond;
  return { grid, game, nation, ada, bea, messages, applied, run, seconds };
}

// A hard nation decides every five seconds: the waits below give it one decision at least.
describe("nation relations (R-BOT-20 to R-BOT-24)", () => {
  it("grow wary of an attacker, tell them so, and heal with time", () => {
    const { game, grid, nation, ada, messages, run, seconds } = strip();
    nation.troops = 1000;
    ada.troops = 5000;
    expect(nationMood(game, 1, 2)).toBe("neutral");
    run(1, [{ player: 2, order: { type: "attack", target: grid.index(25, 1), troops: 100 } }]);
    run(1, [{ player: 2, order: { type: "attack", target: grid.index(25, 0), troops: 100 } }]);
    expect(nationMood(game, 1, 2)).toBe("wary");
    run(seconds(6));
    expect(messages).toContainEqual({ from: 1, to: 2, phrase: Phrase.LeaveMe });
    // Twenty points heal in two minutes.
    run(seconds(120));
    expect(nationMood(game, 1, 2)).toBe("neutral");
  });

  it("thank a player for a gift and come to like them", () => {
    const { game, nation, ada, messages, run, seconds } = strip();
    nation.troops = 1000;
    ada.troops = 5000;
    ada.gold = 100_000;
    nation.gold = 0;
    // Gifts go to allies only (R-DIPLO-06).
    game.alliances.push({ a: 1, b: 2, until: 100_000, renewA: false, renewB: false, truce: false });
    run(1, [{ player: 2, order: { type: "gift", target: 1, troops: 0, gold: 50_000 } }]);
    run(1, [{ player: 2, order: { type: "gift", target: 1, troops: 0, gold: 50_000 } }]);
    expect(nationMood(game, 1, 2)).toBe("friendly");
    run(seconds(6));
    expect(messages).toContainEqual({ from: 1, to: 2, phrase: Phrase.Thanks });
  });

  it("ask a friend for an alliance, and say no to a player it is wary of", () => {
    const { game, grid, nation, ada, bea, messages, applied, run, seconds } = strip();
    nation.troops = 1000;
    ada.troops = 1000;
    bea.troops = 1000;
    ada.gold = 100_000;
    // Gifts go to allies only (R-DIPLO-06): Ada wins the nation over, then the pact lapses.
    game.alliances.push({ a: 1, b: 2, until: 100_000, renewA: false, renewB: false, truce: false });
    run(1, [{ player: 2, order: { type: "gift", target: 1, troops: 0, gold: 50_000 } }]);
    run(1, [{ player: 2, order: { type: "gift", target: 1, troops: 0, gold: 50_000 } }]);
    game.alliances.length = 0;
    run(1, [{ player: 3, order: { type: "attack", target: grid.index(35, 1), troops: 10 } }]);
    run(1, [{ player: 3, order: { type: "attack", target: grid.index(35, 0), troops: 10 } }]);
    expect(nationMood(game, 1, 3)).toBe("wary");
    run(seconds(25));
    expect(applied).toContainEqual({ player: 1, order: { type: "ally", target: 2 } });
    expect(applied).not.toContainEqual({ player: 1, order: { type: "ally", target: 3 } });
    run(1, [{ player: 3, order: { type: "ally", target: 1 } }]);
    run(seconds(6));
    expect(messages).toContainEqual({ from: 1, to: 3, phrase: Phrase.Down });
  });

  it("turn on a traitor at once, and say what it thinks of them", () => {
    const { game, grid, nation, ada, bea, messages, applied, run, seconds } = strip();
    nation.troops = 5000;
    ada.troops = 5000;
    bea.troops = 500;
    run(1, [{ player: 2, order: { type: "ally", target: 1 } }]);
    run(seconds(6));
    expect(game.alliances).toHaveLength(1);
    expect(messages).toContainEqual({ from: 1, to: 2, phrase: Phrase.Up });
    applied.length = 0;
    nation.troops = populationCap(game, nation);
    run(1, [{ player: 2, order: { type: "betray", target: 1 } }]);
    expect(nationMood(game, 1, 2)).toBe("hostile");
    run(seconds(6));
    expect(messages).toContainEqual({ from: 1, to: 2, phrase: Phrase.Angry });
    // Ada is no weaker than the nation and Bea is weaker: the traitor still comes first.
    const attacks = applied.filter(({ player, order }) => player === 1 && order.type === "attack");
    const first = attacks[0]?.order;
    expect(first?.type === "attack" && grid.x(first.target) < 20).toBe(true);
  });

  it("send troops to an ally who asks for help", () => {
    const { game, nation, ada, bea, applied, messages, run, seconds } = strip();
    nation.troops = populationCap(game, nation);
    ada.troops = 10;
    // Bea is too strong to attack: the nation keeps its troops at home.
    bea.troops = 1_000_000;
    run(1, [{ player: 2, order: { type: "ally", target: 1 } }]);
    run(seconds(6));
    expect(game.alliances).toHaveLength(1);
    run(1, [{ player: 2, order: { type: "quick", target: 1, phrase: Phrase.Help } }]);
    run(seconds(6));
    const gifts = applied.filter(
      ({ player, order }) => player === 1 && order.type === "gift" && order.target === 2,
    );
    expect(gifts).toHaveLength(1);
    expect(ada.troops).toBeGreaterThan(10);
    expect(messages).toContainEqual({ from: 1, to: 2, phrase: Phrase.Up });
  });

  it("eye a weak ally, warn them, then betray them and turn on them (R-BOT-25)", () => {
    const { game, grid, nation, ada, bea, messages, applied, run, seconds } = strip();
    // Ada keeps columns 0 to 9 only: half the nation's land, and few troops.
    for (let tile = 0; tile < grid.size; tile++) {
      if (grid.x(tile) >= 10 && grid.x(tile) < 20) game.territory.setOwner(tile, 1);
    }
    nation.troops = populationCap(game, nation);
    ada.troops = 100;
    bea.troops = 1_000_000;
    run(1, [{ player: 2, order: { type: "ally", target: 1 } }]);
    run(seconds(6));
    expect(game.alliances).toHaveLength(1);
    run(seconds(150));
    const down = messages.findIndex((m) => m.from === 1 && m.to === 2 && m.phrase === Phrase.Down);
    const sorry = messages.findIndex(
      (m) => m.from === 1 && m.to === 2 && m.phrase === Phrase.Sorry,
    );
    expect(down).toBeGreaterThanOrEqual(0);
    expect(sorry).toBeGreaterThan(down);
    const betrayal = applied.findIndex(
      ({ player, order }) => player === 1 && order.type === "betray",
    );
    expect(betrayal).toBeGreaterThanOrEqual(0);
    expect(game.alliances).toHaveLength(0);
    const attack = applied.findIndex(
      ({ player, order }, index) =>
        index > betrayal && player === 1 && order.type === "attack" && grid.x(order.target) < 10,
    );
    expect(attack).toBeGreaterThan(betrayal);
  });
});
