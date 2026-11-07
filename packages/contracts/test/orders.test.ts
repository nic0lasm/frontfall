import { describe, expect, expectTypeOf, it } from "vitest";
import { ORDER_SPEC, ORDER_TYPES, type Order, type OrderSpecMatchesOrder } from "../src/orders.ts";
import { DISABLE_ALL, Disable, OPERATOR_BONUS_ALL, OperatorBonus, RuleBit } from "../src/modes.ts";

describe("ORDER_SPEC", () => {
  it("describes the Order union, kind for kind and field for field", () => {
    expectTypeOf<OrderSpecMatchesOrder>().toEqualTypeOf<true>();
    expectTypeOf<(typeof ORDER_TYPES)[number]>().toEqualTypeOf<Order["type"]>();
  });

  it("lists each kind once, and each field of a kind once", () => {
    expect(new Set(ORDER_TYPES).size).toBe(ORDER_SPEC.length);
    for (const { type, fields } of ORDER_SPEC) {
      const names = fields.map(([name]) => name as string);
      expect(new Set(names).size, type).toBe(names.length);
      expect(names, type).not.toContain("type");
    }
  });

  it("gives the types in wire order", () => {
    expect(ORDER_TYPES).toEqual(ORDER_SPEC.map((entry) => entry.type));
  });
});

describe("mode bits", () => {
  it.each([
    ["Disable", Object.values(Disable), DISABLE_ALL],
    ["OperatorBonus", Object.values(OperatorBonus), OPERATOR_BONUS_ALL],
    ["RuleBit", Object.values(RuleBit), 0b111],
  ])("%s has distinct bits that make up the whole set", (_, bits, all) => {
    expect(bits.reduce((sum, bit) => sum | bit, 0)).toBe(all);
    expect(bits.reduce((sum, bit) => sum + bit, 0)).toBe(all);
  });
});
