import { describe, expect, it } from "vitest";
import { allianceState, type Alliance } from "../src/diplomacy.ts";
import type { Game } from "../src/game.ts";
import { StructureKind, structureState, type Structure } from "../src/structures.ts";
import { warshipState, type Warship } from "../src/warships.ts";
import { ALL_RULES, BUSY, type Fixture } from "./fixtures/busy-game.ts";

/**
 * The derived lifecycles (ADR 0009) name conditions the rules used to spell
 * out. Over the two busy games, at every tick, each state must be what those
 * conditions said.
 */
function before(game: Game) {
  return {
    structure: (s: Structure) =>
      game.tick < s.readyAt ? "building" : game.tick < s.reloadAt ? "reloading" : "active",
    alliance: (a: Alliance) =>
      game.tick >= a.until
        ? "ended"
        : a.until - game.tick <= game.balance.allianceRenewTicks
          ? "renewable"
          : "running",
    warship: (w: Warship) =>
      w.health <= 0 || game.player(w.player)?.alive !== true
        ? "sunk"
        : w.step >= w.path.length
          ? "idle"
          : "patrolling",
  };
}

/** Plays a busy game and gives the states it saw, and every state that differed from its old condition. */
function check(fixture: Fixture, ticks: number): { seen: Set<string>; differ: string[] } {
  const game = fixture.newGame();
  const seen = new Set<string>();
  const differ: string[] = [];
  const compare = (what: string, state: string, old: string) => {
    seen.add(`${what} ${state}`);
    if (state !== old) differ.push(`${fixture.name} ${String(game.tick)}: ${what} ${state} ${old}`);
  };
  for (let tick = 0; tick < ticks; tick++) {
    game.step({ tick: game.tick, orders: fixture.orders(game) });
    const old = before(game);
    for (const s of game.structures)
      compare("structure", structureState(game, s), old.structure(s));
    for (const a of game.alliances) compare("alliance", allianceState(game, a), old.alliance(a));
    for (const w of game.warships) compare("warship", warshipState(game, w), old.warship(w));
  }
  return { seen, differ };
}

describe("derived lifecycles", () => {
  const runs = [check(BUSY, 800), check(ALL_RULES, 800)];

  it("agree with the conditions they replace over the busy games", () => {
    expect(runs.flatMap((run) => run.differ)).toEqual([]);
    const seen = new Set(runs.flatMap((run) => [...run.seen]));
    // Their alliances last 200 ticks, all of them within B-ALLIANCE-RENEWAL.
    expect([...seen].sort()).toEqual([
      "alliance ended",
      "alliance renewable",
      "structure active",
      "structure building",
      "structure reloading",
      "warship idle",
      "warship patrolling",
    ]);
  });

  it("name the edges of each life", () => {
    const game = BUSY.newGame();
    for (let tick = 0; tick < 10; tick++) game.step({ tick, orders: [] });
    const silo: Structure = {
      id: 1,
      player: 1,
      kind: StructureKind.Silo,
      tile: 0,
      readyAt: 11,
      reloadAt: 0,
    };
    expect(structureState(game, silo)).toBe("building");
    expect(structureState(game, { ...silo, readyAt: 10 })).toBe("active");
    expect(structureState(game, { ...silo, readyAt: 10, reloadAt: 11 })).toBe("reloading");
    const renew = game.balance.allianceRenewTicks;
    const alliance: Alliance = {
      a: 1,
      b: 2,
      until: 10,
      renewA: false,
      renewB: false,
    };
    expect(allianceState(game, alliance)).toBe("ended");
    expect(allianceState(game, { ...alliance, until: 10 + renew })).toBe("renewable");
    expect(allianceState(game, { ...alliance, until: 11 + renew })).toBe("running");
    const ship: Warship = {
      id: 1,
      player: 1,
      tile: 0,
      health: 1,
      patrol: 0,
      path: new Int32Array(2),
      step: 1,
      reloadAt: 0,
    };
    expect(warshipState(game, ship)).toBe("patrolling");
    expect(warshipState(game, { ...ship, step: 2 })).toBe("idle");
    expect(warshipState(game, { ...ship, health: 0 })).toBe("sunk");
    expect(warshipState(game, { ...ship, player: 9 })).toBe("sunk");
  });
});
