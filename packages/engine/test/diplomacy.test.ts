import { describe, expect, it } from "vitest";
import { captureCost } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBots } from "../src/bots/bots.ts";
import { installNations } from "../src/bots/nations.ts";
import { createGame } from "../src/create-game.ts";
import {
  DIPLOMACY_LOG_SIZE,
  DiplomacyError,
  allianceOf,
  isAllied,
  isTraitor,
  requestBetween,
} from "../src/diplomacy.ts";
import type { Order, Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";
import { WHOLE_PRICES } from "./whole-prices.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  ...WHOLE_PRICES,
  // Troops set by hand above the cap stay put (B-DESERTION).
  desertionBasisPoints: 0,
  spawnPhaseTicks: 0,
  allianceRequestTicks: 20,
  allianceTicks: 100,
  allianceRenewTicks: 30,
  allianceCooldownTicks: 10,
  traitorTicks: 50,
  traitorDefensePercent: 50,
  goldPerThousandTroops: 0,
};

/** Ada holds x < 20 of a 60 × 20 plain, Bea 20 ≤ x < 40, Cy the rest. */
function newGame(overrides: Partial<Balance> = {}, spawnPhaseTicks = 0) {
  const grid = new WorldGrid(60, 20, { wrapsX: false });
  const game = createGame({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
      { id: 3, name: "Cy" },
    ],
    balance: { ...balance, spawnPhaseTicks, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    const x = grid.x(tile);
    game.territory.setOwner(tile, x < 20 ? 1 : x < 40 ? 2 : 3);
  }
  const players = [1, 2, 3].map((id) => game.player(id) as Player);
  for (const player of players) player.troops = 1_000_000;
  const step = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  const ally = (player: number, target: number) =>
    step([{ player, order: { type: "ally", target } }]);
  const betray = (player: number, target: number) =>
    step([{ player, order: { type: "betray", target } }]);
  const [ada, bea, cy] = players as [Player, Player, Player];
  return { game, grid, ada, bea, cy, step, run, ally, betray };
}

describe("diplomacy", () => {
  it("forms an alliance when the asked player asks back (R-DIPLO-01)", () => {
    const { game, ally } = newGame();
    expect(ally(1, 2)).toBe(1);
    expect(requestBetween(game, 1, 2)).toBeDefined();
    expect(isAllied(game, 1, 2)).toBe(false);
    expect(ally(2, 1)).toBe(1);
    expect(isAllied(game, 1, 2)).toBe(true);
    expect(isAllied(game, 2, 1)).toBe(true);
    expect(game.allianceRequests).toHaveLength(0);
    expect(isAllied(game, 1, 3)).toBe(false);
  });

  it("lets a request run out after B-ALLIANCE-REQUEST-TIMEOUT, then waits B-ALLIANCE-REQUEST-COOLDOWN (R-DIPLO-01)", () => {
    const { game, ada, ally, run } = newGame();
    ally(1, 2);
    run(18);
    expect(requestBetween(game, 1, 2)).toBeDefined();
    run(1);
    expect(requestBetween(game, 1, 2)).toBeUndefined();
    expect(orderError(game, ada, { type: "ally", target: 2 })).toBe(DiplomacyError.Cooldown);
    // Another player is not held back.
    expect(orderError(game, ada, { type: "ally", target: 3 })).toBeUndefined();
    run(10);
    expect(orderError(game, ada, { type: "ally", target: 2 })).toBeUndefined();
  });

  it("forms an alliance when both ask in the same turn (R-DIPLO-01)", () => {
    const { game, step } = newGame();
    step([
      { player: 1, order: { type: "ally", target: 2 } },
      { player: 2, order: { type: "ally", target: 1 } },
    ]);
    expect(isAllied(game, 1, 2)).toBe(true);
  });

  it("refuses requests that cannot stand (R-DIPLO-01)", () => {
    const early = newGame({}, 10);
    expect(orderError(early.game, early.ada, { type: "ally", target: 2 })).toBe(
      DiplomacyError.Early,
    );
    const { game, ada, cy, ally } = newGame();
    expect(orderError(game, ada, { type: "ally", target: 1 })).toBe(DiplomacyError.Self);
    expect(orderError(game, ada, { type: "ally", target: 9 })).toBe(DiplomacyError.Player);
    expect(orderError(game, ada, { type: "ally", target: 1.5 })).toBe(DiplomacyError.Player);
    cy.alive = false;
    expect(orderError(game, ada, { type: "ally", target: 3 })).toBe(DiplomacyError.Player);
    ally(1, 2);
    expect(orderError(game, ada, { type: "ally", target: 2 })).toBe(DiplomacyError.Asked);
  });

  it("refuses attacks and landings on an ally's land (R-DIPLO-02)", () => {
    const { game, grid, ada, ally } = newGame();
    ally(1, 2);
    ally(2, 1);
    const allyTile = grid.index(20, 5);
    expect(orderError(game, ada, { type: "attack", target: allyTile, troops: 100 })).toBe(
      DiplomacyError.Ally,
    );
    expect(orderError(game, ada, { type: "embark", target: allyTile, troops: 100 })).toBe(
      DiplomacyError.Ally,
    );
    // Others are fair game.
    expect(
      orderError(game, ada, { type: "attack", target: grid.index(45, 5), troops: 100 }),
    ).not.toBe(DiplomacyError.Ally);
  });

  it("calls off attacks between new allies and sends their troops home (R-DIPLO-02)", () => {
    const { game, grid, ada, bea, step, ally } = newGame();
    // A thinly held Bea, so the attack lasts.
    bea.troops = 400;
    step([{ player: 1, order: { type: "attack", target: grid.index(20, 5), troops: 50_000 } }]);
    expect(game.attacks).toHaveLength(1);
    ally(2, 1);
    const before = ada.troops;
    const sent = game.attacks[0]?.troops ?? 0;
    const land = game.territory.tileCount(1);
    ally(1, 2);
    // As from a retreat: an alliance is no free way back.
    expect(ada.troops).toBe(before + sent - Math.floor((sent * 25) / 100));
    expect(game.attacks).toHaveLength(0);
    expect(game.territory.tileCount(1)).toBe(land);
    expect(bea.alive).toBe(true);
  });

  it("never encircles an ally's pocket (R-DIPLO-02, R-ATTACK-08)", () => {
    const { game, grid, step, ally } = newGame();
    // Bea's tile at (10, 10) sits inside Ada's land, next to a neutral tile Ada is about to take.
    const pocket = grid.index(10, 10);
    const free = grid.index(11, 10);
    game.territory.setOwner(pocket, 2);
    game.territory.setOwner(free, NEUTRAL);
    ally(1, 2);
    ally(2, 1);
    step([{ player: 1, order: { type: "attack", target: free, troops: 1000 } }]);
    step();
    expect(game.territory.ownerOf(free)).toBe(1);
    expect(game.territory.ownerOf(pocket)).toBe(2);
  });

  it("ends an alliance after B-ALLIANCE-DURATION unless both renew (R-DIPLO-03)", () => {
    const { game, ada, ally, run } = newGame();
    ally(1, 2);
    ally(2, 1);
    const until = allianceOf(game, 1, 2)?.until ?? 0;
    expect(orderError(game, ada, { type: "ally", target: 2 })).toBe(DiplomacyError.Renewal);
    run(until - 30 - game.tick);
    // One side alone does not renew.
    expect(ally(1, 2)).toBe(1);
    expect(orderError(game, ada, { type: "ally", target: 2 })).toBe(DiplomacyError.Renewal);
    run(until - game.tick - 1);
    expect(isAllied(game, 1, 2)).toBe(true);
    run(1);
    expect(isAllied(game, 1, 2)).toBe(false);
    // An alliance that runs out marks nobody.
    expect(isTraitor(game, ada)).toBe(false);
  });

  it("renews for a full B-ALLIANCE-DURATION when both ask in the last part (R-DIPLO-03)", () => {
    const { game, ally, run } = newGame();
    ally(1, 2);
    ally(2, 1);
    const alliance = allianceOf(game, 1, 2);
    run((alliance?.until ?? 0) - 10 - game.tick);
    ally(1, 2);
    const tick = game.tick;
    ally(2, 1);
    expect(alliance?.until).toBe(tick + 100);
    expect(alliance?.renewA).toBe(false);
    expect(alliance?.renewB).toBe(false);
    run(50);
    expect(isAllied(game, 1, 2)).toBe(true);
  });

  it("marks a betrayer for B-TRAITOR-DURATION and makes their land cheaper (R-DIPLO-04)", () => {
    const { game, grid, ada, bea, ally, betray, run } = newGame();
    ally(1, 2);
    ally(2, 1);
    const adaTile = grid.index(19, 5);
    const usual = captureCost(game, adaTile, ada);
    expect(betray(1, 2)).toBe(1);
    expect(isAllied(game, 1, 2)).toBe(false);
    expect(isTraitor(game, ada)).toBe(true);
    expect(isTraitor(game, bea)).toBe(false);
    expect(captureCost(game, adaTile, ada)).toBe(Math.max(1, Math.floor(usual / 2)));
    // The betrayer may attack at once.
    expect(
      orderError(game, ada, { type: "attack", target: grid.index(20, 5), troops: 100 }),
    ).toBeUndefined();
    run(48);
    expect(isTraitor(game, ada)).toBe(true);
    run(1);
    expect(isTraitor(game, ada)).toBe(false);
    expect(captureCost(game, adaTile, ada)).toBe(usual);
  });

  it("lets a betrayer attack in the same turn, and not ask the betrayed player straight back (R-DIPLO-04)", () => {
    const { game, grid, ada, step, ally } = newGame();
    ally(1, 2);
    ally(2, 1);
    const target = grid.index(20, 5);
    expect(
      step([
        { player: 1, order: { type: "attack", target, troops: 100 } },
        { player: 1, order: { type: "betray", target: 2 } },
        { player: 1, order: { type: "attack", target, troops: 100 } },
      ]),
    ).toBe(2);
    expect(orderError(game, ada, { type: "ally", target: 2 })).toBe(DiplomacyError.Cooldown);
  });

  it("holds an alliance through the whole of its last tick, for every rule (R-DIPLO-03)", () => {
    const { game, grid, ally, run } = newGame();
    ally(1, 2);
    ally(2, 1);
    const until = allianceOf(game, 1, 2)?.until ?? 0;
    run(until - 1 - game.tick);
    // A pocket of Bea's that Ada surrounds on the alliance's last tick stays Bea's.
    const pocket = grid.index(10, 10);
    const free = grid.index(11, 10);
    game.territory.setOwner(pocket, 2);
    game.territory.setOwner(free, NEUTRAL);
    expect(isAllied(game, 1, 2)).toBe(true);
    game.step({
      tick: game.tick,
      orders: [{ player: 1, order: { type: "attack", target: free, troops: 1000 } }],
    });
    expect(game.territory.ownerOf(free)).toBe(1);
    expect(game.territory.ownerOf(pocket)).toBe(2);
    expect(isAllied(game, 1, 2)).toBe(false);
  });

  it("only betrays an ally (R-DIPLO-04)", () => {
    const { game, ada } = newGame();
    expect(orderError(game, ada, { type: "betray", target: 2 })).toBe(DiplomacyError.NotAllied);
    expect(orderError(game, ada, { type: "betray", target: 9 })).toBe(DiplomacyError.Player);
    const early = newGame({}, 10);
    expect(orderError(early.game, early.ada, { type: "betray", target: 2 })).toBe(
      DiplomacyError.Early,
    );
  });

  it("drops the alliances and requests of an eliminated player", () => {
    const { game, bea, cy, ally, run } = newGame();
    ally(1, 2);
    ally(2, 1);
    ally(3, 1);
    bea.alive = false;
    run(1);
    expect(game.alliances).toHaveLength(0);
    cy.alive = false;
    run(1);
    expect(game.allianceRequests).toHaveLength(0);
  });

  it("logs who allied, whose alliance ran out and who betrayed whom, for every player (R-DIPLO-04)", () => {
    const { game, ally, betray, run } = newGame();
    ally(1, 2);
    ally(2, 1);
    ally(3, 1);
    ally(1, 3);
    betray(3, 1);
    run(100);
    expect(game.diplomacyEvents.map(({ type, a, b }) => [type, a, b])).toEqual([
      ["allied", 1, 2],
      ["allied", 1, 3],
      ["betrayed", 3, 1],
      ["ended", 1, 2],
    ]);
  });

  it("keeps only the latest events when nobody reads the log", () => {
    const { game, ally } = newGame();
    for (let i = 0; i < DIPLOMACY_LOG_SIZE; i++) {
      game.diplomacyEvents.push({ tick: 0, type: "ended", a: 2, b: 3 });
    }
    ally(1, 2);
    ally(2, 1);
    expect(game.diplomacyEvents).toHaveLength(DIPLOMACY_LOG_SIZE);
    expect(game.diplomacyEvents.at(-1)).toMatchObject({ type: "allied", a: 1, b: 2 });
  });

  it("folds alliances, requests and traitor marks into the hash (R-FAIR-01)", () => {
    const a = newGame();
    const b = newGame();
    a.ally(1, 2);
    b.step();
    expect(a.game.hash()).not.toBe(b.game.hash());
    b.ally(1, 2);
    a.step();
    // Same requests, made on different ticks.
    expect(a.game.hash()).not.toBe(b.game.hash());
    const c = newGame();
    const d = newGame();
    for (const game of [c, d]) {
      game.ally(1, 2);
      game.ally(2, 1);
    }
    c.betray(1, 2);
    d.betray(2, 1);
    expect(c.game.hash()).not.toBe(d.game.hash());
  });
});

describe("bots and alliances (R-BOT-10)", () => {
  it("accepts a smaller player's request, up to B-BOT-ALLIANCE-MAX allies", () => {
    const { game, grid, ally, run } = newGame({ allianceRequestTicks: 100, winSharePercent: 100 });
    // Bea holds the most land; Ada and Cy each ask her.
    for (let x = 40; x < 50; x++)
      for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 2);
    installBots(game, [2], "normal");
    ally(1, 2);
    ally(3, 2);
    run(60);
    expect(isAllied(game, 1, 2)).toBe(true);
    expect(isAllied(game, 3, 2)).toBe(false);
  });

  it("refuses a pact that would hold B-WIN-SHARE of the land between the two", () => {
    for (const [winSharePercent, allied] of [
      [80, true],
      [75, false],
    ] as const) {
      const { game, grid, ally, run } = newGame({ allianceRequestTicks: 100, winSharePercent });
      // Bea holds 500 tiles, Ada 400: three quarters of the map together.
      for (let x = 40; x < 45; x++)
        for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 2);
      installBots(game, [2], "normal");
      ally(1, 2);
      run(60);
      expect(isAllied(game, 1, 2)).toBe(allied);
    }
  });

  it("refuses a player attacking it, or a traitor", () => {
    const { game, grid, bea, cy, step, ally, betray, run } = newGame({
      allianceRequestTicks: 100,
      winSharePercent: 100,
      // One tile a tick, so Ada's attack lasts.
      attackSpeedDivisor: 1_000_000,
    });
    for (let x = 40; x < 50; x++)
      for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 2);
    installBots(game, [2], "normal");
    bea.troops = 400;
    step([{ player: 1, order: { type: "attack", target: grid.index(20, 5), troops: 1000 } }]);
    ally(1, 2);
    // Cy betrays Ada, then asks Bea.
    ally(1, 3);
    ally(3, 1);
    betray(3, 1);
    expect(cy.traitorUntil).toBeGreaterThan(game.tick);
    ally(3, 2);
    run(40);
    expect(game.attacks.some((a) => a.player === 1 && a.troops > 0)).toBe(true);
    expect(isAllied(game, 1, 2)).toBe(false);
    expect(isAllied(game, 3, 2)).toBe(false);
  });

  it("renews on the same terms, voting once", () => {
    // A window longer than the bots' interval, so Bea decides once in it.
    const { game, grid, ally, run } = newGame({
      allianceRequestTicks: 100,
      allianceRenewTicks: 60,
      winSharePercent: 100,
    });
    for (let x = 40; x < 50; x++)
      for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 2);
    installBots(game, [2], "normal");
    // Cy is too strong for Bea to attack, so the sizes stay put.
    (game.player(3) as Player).troops = 2_000_000;
    ally(1, 2);
    run(60);
    const alliance = allianceOf(game, 1, 2);
    run((alliance?.until ?? 0) - 55 - game.tick);
    run(50);
    // Bea voted on a decision in the window, and once only: Ada's vote completes the renewal.
    expect(alliance?.renewB).toBe(true);
    const tick = game.tick;
    ally(1, 2);
    expect(alliance?.until).toBe(tick + 100);
  });

  it("lets a larger player's request run out, and never asks", () => {
    const { game, grid, ally, run } = newGame({ allianceRequestTicks: 100 });
    for (let x = 20; x < 30; x++)
      for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 1);
    installBots(game, [2, 3], "normal");
    ally(1, 2);
    run(60);
    expect(isAllied(game, 1, 2)).toBe(false);
    expect(game.allianceRequests.some((r) => r.from === 2 || r.from === 3)).toBe(false);
  });
});

describe("nations and alliances (R-BOT-19)", () => {
  it("accepts a player up to B-NATION-ALLIANCE-SIZE of its land, up to B-NATION-ALLIANCE-MAX allies", () => {
    // Ada, Bea and Cy hold as much land each: a bot would turn both down.
    const { game, ally, run } = newGame({ allianceRequestTicks: 100, winSharePercent: 100 });
    installNations(game, [2], "normal");
    ally(1, 2);
    ally(3, 2);
    run(60);
    expect(isAllied(game, 1, 2)).toBe(true);
    expect(isAllied(game, 3, 2)).toBe(true);
  });

  it("lets the request of a player half again its size or more run out", () => {
    const { game, grid, ally, run } = newGame({ allianceRequestTicks: 100, winSharePercent: 100 });
    // Ada holds 600 tiles to Bea's 400.
    for (let x = 20; x < 30; x++)
      for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 1);
    for (let x = 40; x < 50; x++)
      for (let y = 0; y < 20; y++) game.territory.setOwner(grid.index(x, y), 2);
    installNations(game, [2], "normal");
    ally(1, 2);
    run(60);
    expect(isAllied(game, 1, 2)).toBe(false);
  });
});
