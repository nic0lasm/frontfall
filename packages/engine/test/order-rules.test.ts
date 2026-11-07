import { ORDER_TYPES } from "@frontfall/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { STANDARD_RULES, assertOrderRules, createGame } from "../src/create-game.ts";
import { Game, type GameSetup, type Order } from "../src/game.ts";
import { PLAY_PHASE, defineOrder, planOrder } from "../src/order-rules.ts";
import { ORDER_RULES, orderError } from "../src/orders.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const grid = new WorldGrid(8, 4);

function setup(overrides: Partial<GameSetup> = {}): GameSetup {
  return {
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 3,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    ...overrides,
  };
}

describe("order rules (ADR 0007)", () => {
  it("have one rule for each type of the spec, under its own type", () => {
    expect(Object.keys(ORDER_RULES).sort()).toEqual([...ORDER_TYPES].sort());
    for (const [type, rule] of Object.entries(ORDER_RULES)) expect(rule.type).toBe(type);
  });

  it("are all installed by createGame, as the rules of ORDER_RULES", () => {
    const game = createGame(setup());
    for (const type of ORDER_TYPES) expect(game.hasOrderRule(type), type).toBe(true);
  });

  it("refuse to start a game where a type of order has no rule", () => {
    const game = new Game(setup());
    expect(() => {
      assertOrderRules(game);
    }).toThrow(`no rule for the orders of type ${ORDER_TYPES.join(", ")}`);
    for (const rule of STANDARD_RULES.filter(({ name }) => name !== "warships")) {
      rule.install(game);
    }
    expect(() => {
      assertOrderRules(game);
    }).toThrow("no rule for the orders of type warship, patrol");
  });

  it("are frozen once defined, with their type", () => {
    const rule = defineOrder("work", {
      phases: PLAY_PHASE,
      validate: (_game, _player, order) => order,
      execute: () => true,
    });
    expect(rule.type).toBe("work");
    expect(Object.isFrozen(rule)).toBe(true);
  });

  it("refuse an order out of phase with the rule's reason, or a general one", () => {
    const game = new Game(setup({ balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 5 } }));
    const ada = game.player(1);
    if (!ada) throw new Error("player missing");
    const order = { type: "work", share: 10 } as const;
    const rule = {
      phases: PLAY_PHASE,
      validate: () => order,
      execute: () => true,
    };
    expect(planOrder(game, ada, order, defineOrder("work", rule))).toBe(
      "not allowed in this phase",
    );
    expect(
      planOrder(game, ada, order, defineOrder("work", { ...rule, wrongPhase: "not yet" })),
    ).toBe("not yet");
  });

  it("let orderError pass an order of no known type, which no game carries out", () => {
    const game = createGame(setup());
    const ada = game.player(1);
    if (!ada) throw new Error("player missing");
    const unknown = { type: "march", tile: 1 } as unknown as Order;
    expect(orderError(game, ada, unknown)).toBeUndefined();
    expect(game.apply(1, unknown)).toBe(false);
  });
});
