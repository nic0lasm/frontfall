import { describe, expect, it } from "vitest";
import { pressureOf } from "../src/attacks.ts";
import { capitalFalls, capitalOf } from "../src/capitals.ts";
import { embargoUntil, isTruce } from "../src/diplomacy.ts";
import { doctrineOf } from "../src/doctrines.ts";
import { workShareOf } from "../src/economy.ts";
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
      hash: 3405925131,
      snapshot: "a039a4457f4a0db6ec2fee7bd857ff78c0d25ea3704395242c273bd7ef3722b1",
      state: "121c0624655f108bdb88924f71190756ce6b349796a1b9fe65522af0f62c0a81",
    },
    5: {
      hash: 3046257474,
      snapshot: "4601f3a9434f6ff465bb6dd22cbefd3e25629e72754a8b965029f472c61b0fb8",
      state: "5d88f243c99f4b8edc19ff2624ab80484e5ed7368c8fbf94d9cadbcfcf27e0b7",
    },
    100: {
      hash: 2869801677,
      snapshot: "72c982b85ac2fb90a641ccba2b83501256012bcd24775bed4d7aad84ed9c56a6",
      state: "55a162f341d164c3ada9939cf0e48fa20ce2f7e6683a38a48668f8af11299b13",
    },
    300: {
      hash: 3355310569,
      snapshot: "39a847e0d2910229cddb0d1cc88c84d5a0c0dffe700977cbc491900a5b1104c5",
      state: "b86d8b73aae205c86d907c6820f78252fbc9d64644843d62f0d01afa258a0c37",
    },
    500: {
      hash: 2124772027,
      snapshot: "cace6edf50c1980198067f406da9930b2012409211e1d00a9f9f8796dbc6fb54",
      state: "c0b04656af020e009d52be49a33ddd1d8c7aba6ed75b1a24c3636c6de81f05d3",
    },
    750: {
      hash: 1668013461,
      snapshot: "7966924f800727dc866d89544084141c407ea7dd3ddbbdfbc9931d10727258f8",
      state: "62cdd8bace7449891595be37c6972fc1f794f6f097f956d2de1300e713983b15",
    },
    1000: {
      hash: 2522309376,
      snapshot: "73a1a563b2c223b07dc96051139bb1149463ac6c44da10de90c3e0aff1455818",
      state: "637f25511687119be08871552995d83e40b3cade4652d645b6dab7c8fc442aca",
    },
  },
  allRules: {
    0: {
      hash: 1119067,
      snapshot: "455afea1c35ab5dab61bc0533fc60070a801817076fac57849f95ee74feba34c",
      state: "c5f53d820539e620c2bc45b53c07dd77007b1be094944b7e696d3638b81d08d2",
    },
    5: {
      hash: 1014248096,
      snapshot: "61d568735c3cdc6360ad159f5fde4587211325112b5640bcb98d9ad5f15ab83c",
      state: "ab5169692534c2203d590842bffa1979cf841fa9b9cb062374ca8591bb3ea4ba",
    },
    100: {
      hash: 3835232190,
      snapshot: "c174e59205707f56986005bbc8562a58143de31e74cd711c47669c2fdc91e43b",
      state: "096fc108a98de909748d18225b9ac68ced56c1ac74e6924150000d27e79771cf",
    },
    300: {
      hash: 4091352479,
      snapshot: "8f72a5d7d226f0ebb871f6bb4ccb1c6f9ea0783a36d97faa0ca2e1ccb88c30d2",
      state: "bc83cb1fe7a6f9785665f973b1d329ac2109a0c6a987f598b2a6c2febf9e138c",
    },
    500: {
      hash: 1194692958,
      snapshot: "3a1e9e90b0897b2185aec35d5353e4792e5b096f19c760c8223beae838ba05ef",
      state: "be0bc5f48fe2583b444eaae7d787f2443bb0760effccb8f9cf9f7b4fcf23813f",
    },
    750: {
      hash: 4188223931,
      snapshot: "436edee8e383220a622fcb01319486d341ad849f0c0bb2eac74d22a2a2d39465",
      state: "bc0a3ed2dbc2ea8ef5c9e17f12c62de404605331e1e74a7995d51f5f15d70f70",
    },
    1000: {
      hash: 1135867127,
      snapshot: "6447eb6081170192e874f0d0aaec728996f1b26d6a242be0a21da7e51264d9ad",
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
    game.alliances.some((a) => !isTruce(game, a)),
  );
  mark(
    "truce",
    game.alliances.some((a) => isTruce(game, a)),
  );
  mark(
    "embargo by order",
    game.embargoes.some((e) => embargoUntil(game, e) === 0),
  );
  mark(
    "timed embargo",
    game.embargoes.some((e) => embargoUntil(game, e) !== 0),
  );
  mark(
    "expired quick message",
    game.quickCooldowns.some((c) => c.until <= game.tick),
  );
  mark(
    "pressure",
    game.attacks.some((a) => pressureOf(game, a) > 0),
  );
  mark(
    "collapse",
    game.diplomacyEvents.some((e) => e.type === "collapsed"),
  );
  mark(
    "doctrine",
    game.players().some((p) => doctrineOf(game, p.id) !== 0),
  );
  mark(
    "work share",
    game.players().some((p) => workShareOf(game, p.id) !== 0),
  );
  mark(
    "capital",
    game.players().some((p) => capitalOf(game, p.id) !== undefined),
  );
  mark("capital fall", capitalFalls(game).length > 0);
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
