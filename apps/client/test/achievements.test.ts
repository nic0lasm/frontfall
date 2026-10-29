import { Disable } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE as ACHIEVEMENTS,
  isAchievementId,
  type AchievementId,
} from "../src/achievements/catalog.ts";
import { absorbAchievements, deviceAchievements } from "../src/achievements/account-sync.ts";
import { ACHIEVEMENTS_KEY, AchievementStore } from "../src/achievements/store.ts";
import { AchievementTracker, type AchievementGame } from "../src/achievements/tracker.ts";
import type { GameUpdate, StructureView } from "../src/game/game-view.ts";
import en from "../src/i18n/en.json" with { type: "json" };
import fr from "../src/i18n/fr.json" with { type: "json" };

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

/** A tracker that says which achievements an update earned. */
class Tracker extends AchievementTracker {
  ids(update: GameUpdate): AchievementId[] {
    return [...this.observe(update).fresh];
  }
}

const GAME: AchievementGame = {
  ticksPerSecond: 10,
  ownableTiles: 1000,
  disabled: 0,
  difficulty: "normal",
  teamGame: false,
};

/** An update seen by player 1, among three players. */
function update(changes: Partial<GameUpdate> & { tiles?: number } = {}): GameUpdate {
  const { tiles = 10, ...rest } = changes;
  return {
    you: 1,
    tick: 100,
    phase: "playing",
    spawnTicksLeft: 0,
    players: [1, 2, 3].map((id) => ({
      id,
      name: `P${String(id)}`,
      troops: 10,
      cap: 100,
      gold: 0,
      tiles: id === 1 ? tiles : 10,
      alive: true,
    })),
    attacks: [],
    changedTiles: new Int32Array(0),
    changedOwners: new Uint16Array(0),
    boats: [],
    tradeShips: [],
    warships: [],
    missiles: [],
    fallout: [],
    structures: [],
    diplomacy: {
      allies: [],
      teammates: [],
      incoming: [],
      outgoing: [],
      waiting: [],
      traitors: [],
      embargoes: [],
      embargoedBy: [],
      atWar: [],
      quickIn: 0,
      moods: [],
    },
    events: [],
    ...rest,
  } as GameUpdate;
}

const structure = (type: StructureView["type"], ready = true, player = 1): StructureView => ({
  id: Math.floor(Math.random() * 1e6),
  player,
  type,
  tile: 0,
  ready,
});

describe("the achievement catalogue", () => {
  it("has a name and a description in both languages for each achievement", () => {
    for (const { id } of ACHIEVEMENTS) {
      for (const catalogue of [en, fr] as Record<string, string>[]) {
        expect(catalogue[`achievement.${id}.name`], id).toBeTruthy();
        expect(catalogue[`achievement.${id}.text`], id).toBeTruthy();
      }
    }
  });

  it("has twenty distinct ids and a picture for each", () => {
    expect(new Set(ACHIEVEMENTS.map(({ id }) => id)).size).toBe(20);
    for (const { glyph } of ACHIEVEMENTS) expect(glyph.length).toBeGreaterThan(10);
    expect(isAchievementId("conqueror")).toBe(true);
    expect(isAchievementId("nope")).toBe(false);
  });
});

describe("AchievementTracker", () => {
  it("earns the building achievements only for finished structures of the player", () => {
    const tracker = new Tracker(GAME);
    expect(
      tracker.ids(update({ structures: [structure("city", false), structure("fort", true, 2)] })),
    ).toEqual([]);
    const fresh = tracker.ids(
      update({ structures: [structure("city"), structure("fort"), structure("port")] }),
    );
    expect(fresh.sort()).toEqual(["fortress", "harbor"]);
    // None is earned twice in a game.
    expect(tracker.ids(update({ structures: [structure("city")] }))).toEqual([]);
  });

  it("asks five finished cities for the metropolis, and counts a palace apart", () => {
    const tracker = new Tracker(GAME);
    const four = Array.from({ length: 4 }, () => structure("city"));
    expect(tracker.ids(update({ structures: [...four, structure("palace")] }))).not.toContain(
      "metropolis",
    );
    expect(tracker.ids(update({ structures: [...four, structure("city")] }))).toContain(
      "metropolis",
    );
  });

  it("earns the units and the half map as they happen", () => {
    const tracker = new Tracker(GAME);
    const fresh = tracker.ids(
      update({
        tiles: 500,
        boats: [{ id: 1, player: 1, tile: 0, troops: 5 }],
        warships: [{ id: 1, player: 1, tile: 0, health: 3 }],
        missiles: [{ id: 1, player: 1, heavy: false, tile: 0, to: 0, target: 2 }],
      }),
    );
    expect(fresh.sort()).toEqual(["admiral", "halfWorld", "missile", "setSail"]);
  });

  it("ignores boats, warships and missiles of other players", () => {
    const tracker = new Tracker(GAME);
    expect(
      tracker.ids(
        update({
          boats: [{ id: 1, player: 2, tile: 0, troops: 5 }],
          missiles: [{ id: 1, player: 3, heavy: true, tile: 0, to: 0, target: 1 }],
        }),
      ),
    ).toEqual([]);
  });

  it("earns an alliance in a free-for-all but not from a team", () => {
    const allies = { allies: [{ id: 2, ticksLeft: 100, renewable: false, renewing: false }] };
    const base = update().diplomacy;
    expect(new Tracker(GAME).ids(update({ diplomacy: { ...base, ...allies } }))).toEqual(["ally"]);
    const teams = new Tracker({ ...GAME, teamGame: true });
    expect(teams.ids(update({ diplomacy: { ...base, ...allies } }))).toEqual([]);
  });

  it("earns the victories when the game is won", () => {
    const tracker = new Tracker({ ...GAME, difficulty: "hard" });
    const fresh = tracker.ids(update({ winner: 1, tick: 600 }));
    expect(fresh.sort()).toEqual(["hardVictory", "noMissiles", "quickVictory"]);
  });

  it("gives no victory to a loser, nor against fewer than two rivals", () => {
    expect(new Tracker(GAME).ids(update({ winner: 2 }))).toEqual([]);
    const duel = update({ winner: 1 });
    duel.players = duel.players.slice(0, 2);
    expect(new Tracker(GAME).ids(duel)).toEqual([]);
  });

  it("does not call a slow win quick, nor a win after a missile clean", () => {
    const tracker = new Tracker(GAME);
    tracker.ids(
      update({ missiles: [{ id: 1, player: 1, heavy: false, tile: 0, to: 0, target: 2 }] }),
    );
    const fresh = tracker.ids(update({ winner: 1, tick: 20 * 60 * 10 + 1 }));
    expect(fresh).toEqual([]);
  });

  it("gives no clean-hands win where silos are left out", () => {
    const tracker = new Tracker({ ...GAME, disabled: Disable.Silo });
    expect(tracker.ids(update({ winner: 1 }))).not.toContain("noMissiles");
  });

  it("earns the team victory when a teammate wins", () => {
    const tracker = new Tracker({ ...GAME, teamGame: true });
    const base = update().diplomacy;
    const fresh = tracker.ids(
      update({ winner: 3, winningTeam: 1, diplomacy: { ...base, teammates: [1, 3] } }),
    );
    expect(fresh).toContain("teamVictory");
    expect(
      new AchievementTracker({ ...GAME, teamGame: true }).observe(
        update({ winner: 3, winningTeam: 1, diplomacy: { ...base, teammates: [1, 3] } }),
      ).counts.wins,
    ).toBe(1);
  });

  it("earns the comeback after a fall from 10 % to under 3 %", () => {
    const tracker = new Tracker(GAME);
    tracker.ids(update({ tiles: 150 }));
    tracker.ids(update({ tiles: 20 }));
    tracker.ids(update({ tiles: 200 }));
    expect(tracker.ids(update({ winner: 1, tiles: 760 }))).toContain("comeback");
    const steady = new Tracker(GAME);
    steady.ids(update({ tiles: 150 }));
    expect(steady.ids(update({ winner: 1, tiles: 760 }))).not.toContain("comeback");
  });

  it("earns nothing once the player is out", () => {
    const tracker = new Tracker(GAME);
    const out = update({ structures: [structure("city")] });
    out.players = out.players.map((player) => ({ ...player, alive: player.id !== 1 }));
    expect(tracker.ids(out)).toEqual([]);
  });
});

describe("AchievementStore", () => {
  it("keeps what is earned, once, with the date", () => {
    const storage = memoryStorage();
    const store = new AchievementStore(storage);
    expect(store.record({ fresh: ["ally", "ally", "harbor"], counts: {} }, 1000)).toEqual([
      { id: "ally", level: 1 },
      { id: "harbor", level: 1 },
    ]);
    expect(store.record({ fresh: ["ally", "admiral"], counts: {} }, 2000)).toEqual([
      { id: "admiral", level: 1 },
    ]);
    const { earned } = new AchievementStore(storage).load();
    expect(earned.get("ally")).toEqual({ at: 1000, level: 1 });
    expect(earned.get("admiral")).toEqual({ at: 2000, level: 1 });
    expect(earned.size).toBe(3);
  });

  it("erases everything earned from the device", () => {
    const storage = memoryStorage();
    const store = new AchievementStore(storage);
    store.record({ fresh: ["ally"], counts: { wins: 2 } }, 1000);
    store.clear();
    expect(storage.getItem(ACHIEVEMENTS_KEY)).toBeNull();
    expect(store.load().earned.size).toBe(0);
    expect(() => {
      new AchievementStore(undefined).clear();
    }).not.toThrow();
  });

  it("raises a tiered achievement as its count passes each goal", () => {
    const store = new AchievementStore(memoryStorage());
    expect(store.record({ fresh: [], counts: { wins: 1 } }, 1)).toEqual([
      { id: "conqueror", level: 1 },
    ]);
    expect(store.record({ fresh: [], counts: { wins: 3 } }, 2)).toEqual([]);
    expect(store.record({ fresh: [], counts: { wins: 1, cities: 30 } }, 3)).toEqual([
      { id: "conqueror", level: 2 },
      { id: "builder", level: 2 },
    ]);
    const { earned, counts } = store.load();
    expect(counts).toEqual({ wins: 5, cities: 30, games: 0 });
    expect(earned.get("conqueror")).toEqual({ at: 1, level: 2 });
  });

  it("starts empty from storage it cannot read, and drops ids it does not know", () => {
    expect(new AchievementStore(undefined).load().earned.size).toBe(0);
    expect(
      new AchievementStore(memoryStorage({ [ACHIEVEMENTS_KEY]: "{" })).load().earned.size,
    ).toBe(0);
    const stored = JSON.stringify({
      v: 1,
      earned: { harbor: { at: 5, level: 1 }, later: { at: 6, level: 1 }, ally: { at: "x" } },
      counts: { wins: 2, games: -4 },
    });
    const { earned, counts } = new AchievementStore(
      memoryStorage({ [ACHIEVEMENTS_KEY]: stored }),
    ).load();
    expect([...earned.keys()]).toEqual(["harbor"]);
    expect(counts).toEqual({ wins: 2, cities: 0, games: 0 });
  });

  it("joins achievements kept with an account, losing none of either", () => {
    const storage = memoryStorage();
    const store = new AchievementStore(storage);
    store.record({ fresh: ["ally"], counts: { wins: 1, games: 4 } }, 500);
    expect(deviceAchievements(storage)).toEqual({
      earned: {
        ally: { at: 500, level: 1 },
        conqueror: { at: 500, level: 1 },
        veteran: { at: 500, level: 1 },
      },
      counts: { wins: 1, cities: 0, games: 4 },
    });
    absorbAchievements(
      {
        earned: {
          ally: { at: 900, level: 1 },
          conqueror: { at: 9, level: 2 },
          harbor: { at: 100, level: 1 },
        },
        counts: { wins: 3, games: 2 },
      },
      storage,
    );
    const { earned, counts } = store.load();
    expect(earned.get("ally")).toEqual({ at: 500, level: 1 });
    expect(earned.get("conqueror")).toEqual({ at: 9, level: 2 });
    expect(earned.get("harbor")).toEqual({ at: 100, level: 1 });
    expect(counts).toEqual({ wins: 3, cities: 0, games: 4 });
  });

  it("sends the account only entries it takes", () => {
    const stored = JSON.stringify({
      v: 1,
      earned: {
        harbor: { at: 5 },
        ally: { at: "x" },
        Bad_Id: { at: 1, level: 1 },
        fort: { at: 2, level: 7 },
      },
      counts: { wins: 2, games: -4, cities: 1.5 },
    });
    expect(deviceAchievements(memoryStorage({ [ACHIEVEMENTS_KEY]: stored }))).toEqual({
      earned: { harbor: { at: 5, level: 1 } },
      counts: { wins: 2 },
    });
    expect(deviceAchievements(memoryStorage({ [ACHIEVEMENTS_KEY]: "{" }))).toEqual({
      earned: {},
      counts: {},
    });
  });

  it("does not throw where storage refuses to write", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("full");
    };
    expect(new AchievementStore(storage).record({ fresh: ["ally"], counts: {} }, 1)).toEqual([
      { id: "ally", level: 1 },
    ]);
  });
});

describe("counted by the tracker", () => {
  it("counts each city once and a finished game once", () => {
    const tracker = new Tracker(GAME);
    const city = structure("city");
    expect(tracker.observe(update({ structures: [city] })).counts).toEqual({ cities: 1 });
    expect(tracker.observe(update({ structures: [city] })).counts).toEqual({});
    expect(tracker.observe(update({ winner: 2 })).counts).toEqual({ games: 1 });
    expect(tracker.observe(update({ winner: 2 })).counts).toEqual({});
  });

  it("does not count again what an earlier tracker of the same game credited", () => {
    const first = new Tracker(GAME);
    const city = structure("city");
    first.observe(update({ structures: [city] }));
    first.observe(update({ winner: 2 }));
    const second = new Tracker(GAME, first.credited());
    expect(second.observe(update({ structures: [city] })).counts).toEqual({});
    expect(second.observe(update({ winner: 2 })).counts).toEqual({});
  });
});
