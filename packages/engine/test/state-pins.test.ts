import { describe, expect, it } from "vitest";
import type { Game } from "../src/game.ts";
import { sha256Hex } from "../src/map/sha256.ts";
import { loadSnapshot, saveSnapshot } from "../src/snapshot.ts";
import { ALL_RULES, BUILD, BUSY, type Fixture } from "./fixtures/busy-game.ts";
import { dumpState, stateDigest } from "./fixtures/state-dump.ts";

/**
 * The two busy games of `fixtures/busy-game.ts`, pinned at several ticks by
 * three values: the state hash, the bytes of a snapshot and the dump of the
 * state. A change to how the state is stored may change the first two, never
 * the third: the same dump is the same game. A change to the rules' outcome
 * changes all three; update them on purpose, as the pinned hash of
 * `hash.test.ts`, and say so in the changelog.
 */
const PINS: Record<string, Record<number, Pin>> = {
  busy: {
    0: {
      hash: 2784584871,
      snapshot: "82b3c1724f5f0de7cd4de9de9962cba4acf0c377133e5c550ea93a4b58537f00",
      state: "121c0624655f108bdb88924f71190756ce6b349796a1b9fe65522af0f62c0a81",
    },
    5: {
      hash: 889355206,
      snapshot: "c4be178a2ef84180d2b2522062be2b74a439e9c047b1075155cb3b0a2061e188",
      state: "5d88f243c99f4b8edc19ff2624ab80484e5ed7368c8fbf94d9cadbcfcf27e0b7",
    },
    100: {
      hash: 1092944604,
      snapshot: "34514d0606db807eb2e53dd3e769962b729fede2b70d91752276c13d6993a24b",
      state: "55a162f341d164c3ada9939cf0e48fa20ce2f7e6683a38a48668f8af11299b13",
    },
    300: {
      hash: 3219974907,
      snapshot: "69bc3af0fe9d8a5051f543f5e8b7bd70b4cbe185d1da99df2f03f916eac3efd1",
      state: "b86d8b73aae205c86d907c6820f78252fbc9d64644843d62f0d01afa258a0c37",
    },
    500: {
      hash: 2210671392,
      snapshot: "9fa05d6b017baab7a621495b5b05a7edeaa80bbcf72ba2f928a7f7b77da5101f",
      state: "c0b04656af020e009d52be49a33ddd1d8c7aba6ed75b1a24c3636c6de81f05d3",
    },
    750: {
      hash: 2327730313,
      snapshot: "e6eb63ae144a3d7f090cc9574c32f5c69770f0408cc2ad8af2c7cb4e4e00db42",
      state: "62cdd8bace7449891595be37c6972fc1f794f6f097f956d2de1300e713983b15",
    },
    1000: {
      hash: 775135642,
      snapshot: "9cfeada8ef9d4b802ee546744277e5f8e5b29c85b3eeea15316c08ebc0dfe4fa",
      state: "637f25511687119be08871552995d83e40b3cade4652d645b6dab7c8fc442aca",
    },
  },
  allRules: {
    0: {
      hash: 2768056797,
      snapshot: "cb23ba384ae739e2605206b9b354fde4467bec57ae68216ac23e735cc807755a",
      state: "c5f53d820539e620c2bc45b53c07dd77007b1be094944b7e696d3638b81d08d2",
    },
    5: {
      hash: 23372722,
      snapshot: "05a01c236f438cbd698a60bac2853622655b74d81c447dd2653865eb06106115",
      state: "ab5169692534c2203d590842bffa1979cf841fa9b9cb062374ca8591bb3ea4ba",
    },
    100: {
      hash: 2850171507,
      snapshot: "c4a0c37abb9230d5ea860b19192196c53f5093d0c392b26d0118525ca7329874",
      state: "096fc108a98de909748d18225b9ac68ced56c1ac74e6924150000d27e79771cf",
    },
    300: {
      hash: 2759140109,
      snapshot: "c565986901a8a0dab2120fbcadd176506ef54537dc26913c56fe8a5ad464727d",
      state: "bc83cb1fe7a6f9785665f973b1d329ac2109a0c6a987f598b2a6c2febf9e138c",
    },
    500: {
      hash: 489491879,
      snapshot: "8603347a0b06fe1349a0f4d4b3ae919823320047bae802cd33abd6e45f00c25e",
      state: "be0bc5f48fe2583b444eaae7d787f2443bb0760effccb8f9cf9f7b4fcf23813f",
    },
    750: {
      hash: 3363074382,
      snapshot: "d84a505207bd5b4cf2eeea219b1090f825d2503f3b624631c4adfbd9053290ea",
      state: "bc0a3ed2dbc2ea8ef5c9e17f12c62de404605331e1e74a7995d51f5f15d70f70",
    },
    1000: {
      hash: 613809883,
      snapshot: "50d31a28be4c016f62cd946fd2c21074fa471da69dbd649d12ac3d335a284a61",
      state: "d160f487b5b4fc238012f975743fe9f1f1246511ee6adf980e15852ad548416a",
    },
  },
};

interface Pin {
  /** `game.hash()`. */
  hash: number;
  /** SHA-256 of `saveSnapshot(game, BUILD)`. */
  snapshot: string;
  /** SHA-256 of `dumpState(game)`. */
  state: string;
}

/** Ticks at which each game is pinned: the start, the end of the spawn phase, then along the game. */
const TICKS = [0, 5, 100, 300, 500, 750, 1000];

/** The game at each tick of `TICKS`, and what came into play on the way. */
function play(fixture: Fixture): {
  pins: Record<number, Pin>;
  snapshots: Map<number, Uint8Array>;
  seen: Set<string>;
} {
  const game = fixture.newGame();
  const pins: Record<number, Pin> = {};
  const snapshots = new Map<number, Uint8Array>();
  const seen = new Set<string>();
  const last = TICKS[TICKS.length - 1] as number;
  for (;;) {
    if (TICKS.includes(game.tick)) {
      const bytes = saveSnapshot(game, BUILD);
      snapshots.set(game.tick, bytes);
      pins[game.tick] = { hash: game.hash(), snapshot: sha256Hex(bytes), state: stateDigest(game) };
    }
    if (game.tick === last) break;
    game.step({ tick: game.tick, orders: fixture.orders(game) });
    note(game, seen);
  }
  return { pins, snapshots, seen };
}

/** Names what is in play in the game, for every gate of the hash and the snapshot. */
function note(game: Game, seen: Set<string>): void {
  const mark = (what: string, present: boolean) => {
    if (present) seen.add(what);
  };
  mark(
    "alliance",
    game.alliances.some((a) => !a.truce),
  );
  mark(
    "truce",
    game.alliances.some((a) => a.truce),
  );
  mark(
    "embargo by order",
    game.embargoes.some((e) => e.until === 0),
  );
  mark(
    "timed embargo",
    game.embargoes.some((e) => e.until !== 0),
  );
  mark(
    "expired quick message",
    game.quickCooldowns.some((c) => c.until <= game.tick),
  );
  mark(
    "pressure",
    game.attacks.some((a) => a.pressure > 0),
  );
  mark(
    "collapse",
    game.diplomacyEvents.some((e) => e.type === "collapsed"),
  );
  mark(
    "doctrine",
    game.players().some((p) => p.doctrine !== 0),
  );
  mark(
    "work share",
    game.players().some((p) => p.workShare !== 0),
  );
  mark(
    "capital",
    game.players().some((p) => p.capital !== undefined),
  );
  mark("capital fall", game.capitalFalls.length > 0);
  mark(
    "landmark",
    game.diplomacyEvents.some((e) => e.type === "landmark"),
  );
  mark("winner", game.winner !== undefined);
  mark("winning team", game.winningTeam !== undefined);
  mark("teams", game.teams > 0);
  mark("left out", game.disabled !== 0);
  mark("operator", game.operator.bonuses !== 0);
}

describe("the pinned busy games", () => {
  const played = { busy: play(BUSY), allRules: play(ALL_RULES) };

  it("bring every gate of the hash and the snapshot into play", () => {
    expect([...played.busy.seen].sort()).toEqual([
      "alliance",
      "embargo by order",
      "expired quick message",
      "timed embargo",
      "winner",
    ]);
    expect([...played.allRules.seen].sort()).toEqual([
      "alliance",
      "capital",
      "capital fall",
      "collapse",
      "doctrine",
      "embargo by order",
      "expired quick message",
      "landmark",
      "left out",
      "operator",
      "pressure",
      "teams",
      "timed embargo",
      "truce",
      "winner",
      "winning team",
      "work share",
    ]);
  });

  it("match their pinned hash, snapshot bytes and state dump", () => {
    expect({ busy: played.busy.pins, allRules: played.allRules.pins }).toEqual(PINS);
  });

  it("load their pinned snapshots back to the same bytes and state", () => {
    for (const [fixture, { snapshots, pins }] of [
      [BUSY, played.busy],
      [ALL_RULES, played.allRules],
    ] as const) {
      for (const [tick, bytes] of snapshots) {
        const loaded = loadSnapshot(bytes, BUILD, fixture.newGame);
        if (!loaded.ok) throw new Error(`${fixture.name} at ${String(tick)}: ${loaded.reason}`);
        expect(saveSnapshot(loaded.game, BUILD)).toEqual(bytes);
        expect(loaded.game.hash()).toBe(pins[tick]?.hash);
      }
    }
  });

  it("refuse to dump a field the dump does not know", () => {
    const game = BUSY.newGame();
    Object.assign(game.players()[0] as object, { morale: 1 });
    expect(() => dumpState(game)).toThrow("the state dump does not know player.morale");
  });
});
