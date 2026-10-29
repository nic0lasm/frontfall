import { DEFAULT_BALANCE } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { attackPreview, goldPerSecond, soldiersOf } from "../src/game/attack-preview.ts";
import type { GameUpdate, PlayerView } from "../src/game/game-view.ts";

const balance = {
  ...DEFAULT_BALANCE,
  neutralCost: 10,
  defenseDensityTenths: 10,
  popPerTile: 40,
  traitorDefensePercent: 50,
  goldPerThousandTroops: 5,
  workGoldFactor: 4,
  goldBase: 0,
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
  it("prices unclaimed land at B-NEUTRAL-COST", () => {
    const preview = attackPreview(update([player(1, 1000, 10)]), 0, 50, balance);
    expect(preview).toEqual({ target: 0, troops: 500, perTile: 10, tiles: 50, capGain: 2000 });
  });

  it("adds the defender's soldiers per tile, which their workers do not raise (R-ECO-07)", () => {
    const you = player(1, 1000, 10);
    const idle = attackPreview(update([you, player(2, 900, 10)]), 2, 100, balance);
    expect(idle?.perTile).toBe(100);
    expect(idle?.tiles).toBe(10);
    const busy = attackPreview(update([you, player(2, 900, 10, 50)]), 2, 100, balance);
    // 450 soldiers over 10 tiles: 45 a tile on top of 10.
    expect(busy?.perTile).toBe(55);
    // 18 tiles worth of troops, but only 10 to take.
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
    // 600 soldiers, half of them sent; (10 + 20) / 2 a tile.
    expect(preview).toMatchObject({ troops: 300, perTile: 15, tiles: 20 });
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
    expect(goldPerSecond({ troops: 1000, workShare: 0 }, { ...balance, goldBase: 500 })).toBe(505);
  });

  it("splits soldiers and workers, and pays workers B-WORK-GOLD times", () => {
    expect(soldiersOf({ troops: 1001, workShare: 30 })).toBe(701);
    expect(goldPerSecond({ troops: 1000, workShare: 0 }, balance)).toBe(5);
    expect(goldPerSecond({ troops: 1000, workShare: 50 }, balance)).toBe(12.5);
  });
});
