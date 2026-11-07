import { describe, expect, it } from "vitest";
import type { GameRules } from "@frontfall/contracts";
import {
  BALANCE_SPEC,
  DEFAULT_BALANCE,
  checkBalance,
  digestBalance,
  digestGate,
  type Balance,
} from "../src/balance.ts";

/*
 * The balance spec (ADR 0009) replaced a list of checks and a gating of the
 * digest by key prefix. The two functions below are those, as they were:
 * every answer of the spec must be theirs.
 */

/** The digest as it was gated before the spec: by the prefix of each key. */
function digestBefore(balance: Balance, rules: GameRules, landmarks: boolean): number {
  let digest = 0x811c9dc5;
  const record = balance as unknown as Record<string, number | readonly number[]>;
  for (const key of Object.keys(record).sort()) {
    if (!rules.capitals && key.startsWith("capital")) continue;
    // Likewise landmarks (R-LAND) count only on a map that has some.
    if (!landmarks && key.startsWith("landmark")) continue;
    for (let i = 0; i < key.length; i++) digest = Math.imul(digest ^ key.charCodeAt(i), 0x01000193);
    const value = record[key];
    for (const number of typeof value === "number" ? [value] : (value ?? [])) {
      // Halves, like the state hash: balance values are safe integers.
      for (const word of [number >>> 0, Math.floor(number / 2 ** 32) >>> 0]) {
        for (let shift = 0; shift < 32; shift += 8) {
          digest = Math.imul(digest ^ ((word >>> shift) & 0xff), 0x01000193);
        }
      }
    }
  }
  return digest >>> 0;
}

/** Refuses balance values the rules cannot run with, before the first tick rather than during one. */
function checkBefore(balance: Balance): void {
  const atLeastOne: (keyof Balance)[] = [
    "ticksPerSecond",
    "attackSpeedDivisor",
    "encircleMaxTiles",
    "collapseBuildupTicks",
    "collapseDepth",
    "boatSpeed",
    "boatMax",
    "boatRange",
    "tradeRange",
    "growthDivisor",
    "tradeIntervalTicks",
    "tradeOdds",
    "warshipPatrol",
    "warshipReloadTicks",
    "warshipDamage",
    "warshipHealth",
    "missileSpeed",
    "allianceRequestTicks",
    "allianceTicks",
    "maxDurationTicks",
  ];
  for (const key of atLeastOne) {
    const value = balance[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`balance ${key} must be a positive integer`);
    }
  }
  // Two structures on one tile would make demolition ambiguous; a cheaper next structure, or a negative cost, would print gold.
  if (!Number.isSafeInteger(balance.buildSpacing) || balance.buildSpacing < 1) {
    throw new RangeError("balance buildSpacing must be a positive integer");
  }
  for (const key of [
    "cityCost",
    "fortCost",
    "portCost",
    "buildTicks",
    "tradeMax",
    "costMax",
    "fortCostMax",
    "airDefenseCostMax",
    "popBase",
    "popLand",
    "popPerCity",
    "growthBase",
    "workGoldPercent",
    "warshipCost",
    "warshipMax",
    "warshipRange",
    "warMemoryTicks",
    "embargoNoticeTicks",
    "embargoAutoTicks",
    "tributeTruceTicks",
    "tributeBase",
    "tributePerTile",
    "tributeLeadPercent",
    "siloCost",
    "airDefenseCost",
    "longBuildTicks",
    "siloReloadTicks",
    "missileCost",
    "heavyMissileCost",
    "missileRadius",
    "heavyMissileRadius",
    "falloutTicks",
    "lightFalloutTicks",
    "falloutCostPercent",
    "missileTroopsPercent",
    "heavyMissileTroopsPercent",
    "airDefenseRadius",
    "airDefenseReloadTicks",
    "allianceRenewTicks",
    "allianceCooldownTicks",
    "traitorTicks",
    "traitorDefensePercent",
    "collapseOddsTenths",
    "collapseCostPercent",
    "cityLand",
    "goldBase",
    "attackPacePercent",
    "attackPaceOddsTenths",
    "capitalRadius",
    "capitalStrengthPercent",
    "capitalAlert",
    "capitalGraceTicks",
    "capitalGarrisonPercent",
    "landmarkGoldPercent",
    "landmarkGrowthPercent",
    "landmarkFortressRadius",
    "landmarkFortressPercent",
    "landmarkTradePercent",
    "landmarkShieldRadius",
  ] as const) {
    if (!Number.isSafeInteger(balance[key]) || balance[key] < 0) {
      throw new RangeError(`balance ${key} must be a non-negative integer`);
    }
  }
  if (
    !Number.isSafeInteger(balance.workMaxPercent) ||
    balance.workMaxPercent < 0 ||
    balance.workMaxPercent > 100
  ) {
    throw new RangeError("balance workMaxPercent must be from 0 to 100");
  }
  for (const key of ["capitalSpoilsPercent", "capitalRazePercent"] as const) {
    if (!Number.isSafeInteger(balance[key]) || balance[key] < 0 || balance[key] > 100) {
      throw new RangeError(`balance ${key} must be from 0 to 100`);
    }
  }
  for (const key of ["landmarkShieldChancePercent", "landmarkAssaultPercent"] as const) {
    if (!Number.isSafeInteger(balance[key]) || balance[key] < 0 || balance[key] > 100) {
      throw new RangeError(`balance ${key} must be from 0 to 100`);
    }
  }
  const chance = balance.airDefenseChancePercent;
  if (!Number.isSafeInteger(chance) || chance < 0 || chance > 100) {
    throw new RangeError("balance airDefenseChancePercent must be from 0 to 100");
  }
  if (!Number.isSafeInteger(balance.costGrowthPercent) || balance.costGrowthPercent < 100) {
    throw new RangeError("balance costGrowthPercent must be 100 or more");
  }
  // Ship routes keep their distances in 16 bits.
  if (balance.boatRange > 0xffff) throw new RangeError("balance boatRange is above 65535");
  if (balance.tradeRange > 0xffff) throw new RangeError("balance tradeRange is above 65535");
}

const KEYS = Object.keys(DEFAULT_BALANCE) as (keyof Balance)[];

/** What `check` throws for a balance, or "" when it takes it. */
function refusalOf(check: (balance: Balance) => void, balance: Balance): string {
  try {
    check(balance);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

/** Wrong values to try for a key: below and above any range, a fraction, and not a number. */
const WRONG = [-1, 0, 99, 101, 0x10000, 1.5, Number.NaN, 2 ** 53];

function withValue(key: keyof Balance, value: number): Balance {
  return { ...DEFAULT_BALANCE, [key]: value };
}

describe("BALANCE_SPEC (ADR 0009)", () => {
  it("covers every key of the balance", () => {
    expect(Object.keys(BALANCE_SPEC).sort()).toEqual([...KEYS].sort());
    expect(KEYS).toHaveLength(110);
  });

  it("refuses what the checks before it refused, with the same words", () => {
    expect(refusalOf(checkBalance, DEFAULT_BALANCE)).toBe("");
    for (const key of KEYS) {
      for (const value of WRONG) {
        const balance = withValue(key, value);
        expect(refusalOf(checkBalance, balance), `${key} ${String(value)}`).toBe(
          refusalOf(checkBefore, balance),
        );
      }
    }
  });

  it("names the same value first when several are wrong", () => {
    const wrong = KEYS.filter((key) => refusalOf(checkBefore, withValue(key, -1)) !== "");
    expect(wrong.length).toBeGreaterThan(80);
    for (let i = 0; i < wrong.length; i++) {
      for (const j of [i + 1, i + 7, wrong.length - 1 - i]) {
        const a = wrong[i] as keyof Balance;
        const b = wrong[j % wrong.length] as keyof Balance;
        const balance = { ...withValue(a, -1), [b]: 0x10000 };
        expect(refusalOf(checkBalance, balance), `${a} ${b}`).toBe(refusalOf(checkBefore, balance));
      }
    }
  });

  it("gates the digest on the keys the prefixes gated, and nothing else", () => {
    for (const key of KEYS) {
      const gate = digestGate(key);
      if (key.startsWith("capital")) expect(gate, key).toEqual({ rule: "capitals" });
      else if (key.startsWith("landmark")) expect(gate, key).toEqual({ map: "landmarks" });
      else expect(gate, key).toBeUndefined();
    }
  });

  it("digests every balance as before, with each rule on or off and with or without landmarks", () => {
    const changed = { ...DEFAULT_BALANCE, capitalRadius: 9, landmarkGoldPercent: 3, boatMax: 7 };
    for (const balance of [DEFAULT_BALANCE, changed]) {
      for (let bits = 0; bits < 8; bits++) {
        const rules: GameRules = {
          capitals: (bits & 1) !== 0,
          collapsingFronts: (bits & 2) !== 0,
          doctrines: (bits & 4) !== 0,
        };
        for (const landmarks of [false, true]) {
          expect(digestBalance(balance, rules, landmarks)).toBe(
            digestBefore(balance, rules, landmarks),
          );
        }
      }
    }
  });
});
