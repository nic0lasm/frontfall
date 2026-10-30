import { DEFAULT_BALANCE } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { attackPreview, goldPerSecond, soldiersOf } from "../src/game/attack-preview.ts";
import type { GameUpdate, PlayerView } from "../src/game/game-view.ts";

const balance = {
  ...DEFAULT_BALANCE,
  tileWeightTenths: [80, 100, 120] as const,
  neutralSharePercent: 20,
  lossBaseThousandths: 463,
  lossDensityThousandths: 39,
  oddsMinPercent: 60,
  oddsMaxPercent: 200,
  largeMidTiles: 300_000,
  popLand: 200,
  traitorDefensePercent: 50,
  goldPerThousandTroops: 0,
  workGoldPercent: 150,
  goldBase: 1000,
};

function player(id: number, troops: number, tiles: number, workShare = 0): PlayerView {
  return { id, name: `P${String(id)}`, troops, cap: 0, gold: 0, workShare, tiles, alive: true };
}

function update(players: PlayerView[], diplomacy: Partial<GameUpdate["diplomacy"]> = {}) {
  return {
    you: 1,
    phase: "play",
    players,
    diplomacy: { allies: [], teammates: [], traitors: [], ...diplomacy },
  } as unknown as GameUpdate;
}

describe("attack preview", () => {
  it("prices unclaimed land at a share of the weight of plains", () => {
    const preview = attackPreview(update([player(1, 1000, 10)]), 0, 50, balance);
    // 500 / 1.6 tiles; 200 × (322^0.6 − 10^0.6) of cap for them.
    expect(preview).toEqual({ target: 0, troops: 500, perTile: 1.6, tiles: 312, capGain: 5597 });
  });

  it("prices a player's land by the odds and their soldiers per tile, which workers do not raise (R-ECO-07)", () => {
    const you = player(1, 1000, 10);
    // 900 soldiers against 1000: 8 × 0.9 × (0.463 + 0.039 × 90).
    const idle = attackPreview(update([you, player(2, 900, 10)]), 2, 100, balance);
    expect(idle?.perTile).toBe(28.6);
    expect(idle?.tiles).toBe(10);
    // 450 soldiers: the odds floor of 0.6, then 8 × 0.6 × (0.463 + 0.039 × 45).
    const busy = attackPreview(update([you, player(2, 900, 10, 50)]), 2, 100, balance);
    expect(busy?.perTile).toBe(10.6);
    expect(busy?.tiles).toBe(10);
  });

  it("sends soldiers only, and halves the price of a traitor's land", () => {
    const you = player(1, 1000, 10, 40);
    const preview = attackPreview(
      update([you, player(2, 2000, 100)], { traitors: [{ id: 2, ticksLeft: 50 }] }),
      2,
      50,
      balance,
    );
    // 600 soldiers, half of them sent against 2000: odds of 2, 8 × 2 × (0.463 + 0.039 × 20) / 2.
    expect(preview).toMatchObject({ troops: 300, perTile: 9.9, tiles: 30 });
  });

  it("has nothing to say about one's own land, an ally, a teammate, or before play", () => {
    const players = [player(1, 1000, 10), player(2, 100, 10), player(3, 100, 10)];
    expect(attackPreview(update(players), 1, 50, balance)).toBeUndefined();
    const allied = update(players, {
      allies: [{ id: 2, ticksLeft: 9, renewable: false, renewing: false }],
    });
    expect(attackPreview(allied, 2, 50, balance)).toBeUndefined();
    expect(attackPreview(update(players, { teammates: [3] }), 3, 50, balance)).toBeUndefined();
    const spawn = { ...update(players), phase: "spawn" } as GameUpdate;
    expect(attackPreview(spawn, 2, 50, balance)).toBeUndefined();
  });

  it("counts the base income every player earns (B-GOLD-BASE)", () => {
    expect(goldPerSecond({ troops: 1000, workShare: 0, cap: 4000 }, balance)).toBe(1000);
  });

  it("splits soldiers and workers, and pays B-WORK-GOLD more for the share of the cap at work", () => {
    expect(soldiersOf({ troops: 1001, workShare: 30 })).toBe(701);
    // 500 workers fill an eighth of a cap of 4000: 150 % of an eighth more.
    expect(goldPerSecond({ troops: 1000, workShare: 50, cap: 4000 }, balance)).toBe(1187.5);
    // Never past the whole cap.
    expect(goldPerSecond({ troops: 1000, workShare: 80, cap: 500 }, balance)).toBe(2500);
  });
});
