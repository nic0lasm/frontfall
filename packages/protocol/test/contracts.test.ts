import {
  DIFFICULTIES,
  DISABLE_ALL,
  MAX_TEAMS,
  OPERATOR_BONUS_ALL,
  ORDER_SPEC,
  type GameRules as SharedRules,
} from "@frontfall/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Difficulty, Disabled, GameRules, OperatorBonusBits, Teams } from "../src/messages.ts";
import { ORDER_KINDS, Order } from "../src/orders.ts";

// The schemas of the messages check the values the contracts define: the two must not drift apart.
describe("schemas and the contracts", () => {
  it("take the order kinds from the spec, in wire order", () => {
    expect(ORDER_KINDS).toEqual(
      ORDER_SPEC.map(({ type, fields }) => ({ type, fields: fields.map(([name]) => name) })),
    );
  });

  it("accept no field an order kind does not have", () => {
    expect(Order.safeParse({ type: "spawn", tile: 1 }).success).toBe(true);
    expect(Order.safeParse({ type: "spawn", tile: 1, troops: 2 }).success).toBe(false);
    expect(Order.safeParse({ type: "spawn" }).success).toBe(false);
    expect(Order.safeParse({ type: "march", tile: 1 }).success).toBe(false);
  });

  it("bound each kind of field", () => {
    const ok = (order: object) => Order.safeParse(order).success;
    expect(ok({ type: "spawn", tile: 2 ** 31 - 1 })).toBe(true);
    expect(ok({ type: "spawn", tile: 2 ** 31 })).toBe(false);
    expect(ok({ type: "retreat", attack: 0 })).toBe(false);
    expect(ok({ type: "gift", target: 2, troops: 0, gold: 0 })).toBe(true);
    expect(ok({ type: "gift", target: 0, troops: 1, gold: 0 })).toBe(false);
    expect(ok({ type: "ally", target: 0x10000 })).toBe(false);
    expect(ok({ type: "doctrine", pick: 255 })).toBe(true);
    expect(ok({ type: "doctrine", pick: 256 })).toBe(false);
    expect(ok({ type: "embargo", target: 2, on: 2 })).toBe(false);
    expect(ok({ type: "work", share: 100 })).toBe(true);
    expect(ok({ type: "work", share: 101 })).toBe(false);
    expect(ok({ type: "attack", target: 1, troops: 1.5 })).toBe(false);
  });

  it("allow every difficulty, team count and bit the contracts define", () => {
    expect(Difficulty.options).toEqual([...DIFFICULTIES]);
    expect(Teams.safeParse(0).success).toBe(true);
    expect(Teams.safeParse(1).success).toBe(false);
    for (let teams = 2; teams <= MAX_TEAMS; teams++) {
      expect(Teams.safeParse(teams).success).toBe(true);
    }
    expect(Teams.safeParse(MAX_TEAMS + 1).success).toBe(false);
    expect(Disabled.safeParse(DISABLE_ALL).success).toBe(true);
    expect(Disabled.safeParse(DISABLE_ALL + 1).success).toBe(false);
    expect(OperatorBonusBits.safeParse(OPERATOR_BONUS_ALL).success).toBe(true);
    expect(OperatorBonusBits.safeParse(OPERATOR_BONUS_ALL + 1).success).toBe(false);
  });

  it("carry the special rules the engine plays", () => {
    expectTypeOf<GameRules>().toEqualTypeOf<{ -readonly [K in keyof SharedRules]: boolean }>();
  });
});
