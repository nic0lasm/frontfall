import { describe, expect, it } from "vitest";
import { DOCTRINE_COUNT } from "../src/doctrines.ts";
import type { Game } from "../src/game.ts";
import { loadSnapshot, saveSnapshot } from "../src/snapshot.ts";
import { PlayerValues, RecordList, SlotValues } from "../src/state/parts.ts";
import { ALL_RULES, BUILD, BUSY, type Fixture } from "./fixtures/busy-game.ts";

/**
 * Every field of the state must reach the state hash and snapshots. For each
 * entity list of `Game`, for each `Player`, for the game's own numbers and
 * for each value of the rule parts, the two busy games are played until an
 * entry exists; then each of its fields is set to another valid value, and
 * the hash must change and a snapshot must carry the value, unless `EXEMPT`
 * says why not.
 */

/** Gives another valid value for a field, or undefined when this entry has none to give. */
type Change = (value: unknown, game: Game) => unknown;

const count: Change = (v) => (v as number) + 1;
const flag: Change = (v) => !(v as boolean);
/** Player 1, or player 2 for player 1: a player id or a team, set or not. */
const player: Change = (v) => (v === 1 ? 2 : 1);
const tile: Change = (v, game) =>
  (v as number) + 1 < game.terrain.topology.size ? (v as number) + 1 : (v as number) - 1;
const optionalTile: Change = (v, game) => (v === undefined ? 0 : tile(v, game));
const optionalCount: Change = (v) => (v === undefined ? 1 : (v as number) + 1);
/** A tile, or -1 for none, as parts keep them. */
const tileOrNone: Change = (v, game) => ((v as number) < 0 ? 0 : tile(v, game));

/**
 * The same route with one corner cut the other way round: as long, with the
 * same ends, and still a route from tile to neighbouring tile.
 */
const route: Change = (v, game) => {
  const path = v as Int32Array;
  const topology = game.terrain.topology;
  const around = new Int32Array(4);
  const next = new Int32Array(4);
  for (let i = 1; i + 1 < path.length; i++) {
    const [before, at, after] = [path[i - 1], path[i], path[i + 1]] as [number, number, number];
    const sides = topology.neighborsInto(before, around);
    for (let n = 0; n < sides; n++) {
      const corner = around[n] as number;
      if (corner === at || corner === after) continue;
      const reach = topology.neighborsInto(corner, next);
      if (!next.subarray(0, reach).includes(after)) continue;
      const changed = path.slice();
      changed[i] = corner;
      return changed;
    }
  }
  return undefined;
};

/** The other valid values of every field, by entity: a field the state gains must be listed here. */
const CHANGES: Record<string, Record<string, Change>> = {
  player: {
    id: (v) => (v as number) + 10,
    name: (v) => `${String(v)}!`,
    troops: count,
    gold: count,
    goldRemainder: count,
    alive: flag,
    start: optionalTile,
    traitorUntil: count,
    home: optionalTile,
    team: player,
  },
  game: {
    seed: count,
    nextAttackId: count,
    nextBoatId: count,
    nextStructureId: count,
    nextTradeShipId: count,
    nextWarshipId: count,
    nextMissileId: count,
    teams: (v) => ((v as number) === 2 ? 3 : 2),
    disabled: count,
    winner: player,
    winningTeam: player,
    decidedAt: optionalCount,
    currentTick: count,
    setup: optionalCount,
    balanceDigest: count,
  },
  attacks: { id: count, player, target: player, aim: tile, troops: count },
  boats: { id: count, player, target: tile, troops: count, path: route, step: count },
  structures: {
    id: count,
    player,
    kind: (v) => ((v as number) + 1) % 7,
    tile,
    readyAt: count,
    reloadAt: count,
  },
  tradeShips: { id: count, player, port: count, from: tile, to: tile, path: route, step: count },
  warships: {
    id: count,
    player,
    tile,
    health: count,
    patrol: tile,
    path: route,
    step: count,
    reloadAt: count,
    firedAt: count,
    aim: tile,
  },
  missiles: {
    id: count,
    player,
    size: (v) => 1 - (v as number),
    from: tile,
    to: tile,
    launchedAt: count,
    arrivesAt: count,
    tried: (v) => [...(v as number[]), 1],
  },
  fallout: { tile, radius: count, until: count },
  fights: { a: player, b: player, until: count },
  alliances: { a: player, b: player, until: count, renewA: flag, renewB: flag },
  allianceRequests: { from: player, to: player, expiresAt: count },
  requestCooldowns: { from: player, to: player, until: count },
  embargoes: { from: player, to: player, since: count },
  quickCooldowns: { player, until: count },
  // The values of the rule parts (ADR 0008), by part name: one entry per player or per list slot.
  "part work": { value: (v) => ((v as number) === 0 ? 1 : (v as number) - 1) },
  "part doctrines": { value: (v) => ((v as number) + 1) % DOCTRINE_COUNT },
  "part capitals": { value: tileOrNone },
  "part capital falls": { tick: count, player, by: player, tile },
  "part fronts": { value: count },
  "part truces": { value: (v) => 1 - (v as number) },
  "part embargo ends": { value: count },
};

/**
 * Parts a rule keeps in a closure, saved and hashed as a whole but not
 * changed value by value here: the state dump pins their bytes. By the
 * start of their name.
 */
const WHOLE_PARTS: Record<string, string> = {
  trade: "the open ports in the order they opened",
  "bots ": "when each bot may search again",
  "nations ": "when each nation may search again",
  "nation memory ": "what each nation remembers of the others",
};

interface Exemption {
  readonly entity: string;
  readonly key: string;
  /** What leaves the field out: the state hash, snapshots, or both. */
  readonly from: "hash" | "snapshot" | "both";
  /** When it is left out; always if not given. */
  readonly when?: (game: Game, entry: Record<string, unknown>) => boolean;
  readonly reason: string;
}

/** Fields the state hash or snapshots leave out, on purpose, and why. */
const EXEMPT: readonly Exemption[] = [
  { entity: "player", key: "id", from: "snapshot", reason: "setup, checked by the setup digest" },
  { entity: "player", key: "name", from: "both", reason: "setup, read by the setup digest only" },
  { entity: "player", key: "home", from: "snapshot", reason: "setup, from the map's manifest" },
  { entity: "player", key: "team", from: "snapshot", reason: "setup, dealt from the teams" },
  { entity: "game", key: "seed", from: "both", reason: "setup, read by the setup digest only" },
  { entity: "game", key: "teams", from: "snapshot", reason: "setup, checked by the setup digest" },
  {
    entity: "game",
    key: "disabled",
    from: "snapshot",
    reason: "setup, checked by the setup digest",
  },
  {
    entity: "game",
    key: "balanceDigest",
    from: "snapshot",
    reason: "setup, checked by the setup digest",
  },
  { entity: "game", key: "setup", from: "both", reason: "a cache of setupDigest(), not state" },
  { entity: "warships", key: "firedAt", from: "both", reason: "for the screen only" },
  { entity: "warships", key: "aim", from: "both", reason: "for the screen only" },
];

/** Arrays of `Game` that are not entity lists of the state, and why. */
const NOT_STATE: Record<string, string> = {
  sortedPlayers: "the players, checked field by field as `player`",
  systems: "the tick systems of the rules installed",
  observers: "the order observers of the rules installed",
  persisted: "the rule parts, checked value by value as `part <name>`, or whole in `WHOLE_PARTS`",
  parts: "the same rule parts, by the slot of their key",
  diplomacyEvents: "what happened, for the interfaces: no rule reads it back",
  missileEvents: "how missiles ended, for the interfaces: no rule reads it back",
};

const fields = (item: object) => item as Record<string, unknown>;

/** A value of a part, as an entry whose `value` reads and writes it. */
function valueEntry(get: () => number, set: (value: number) => void): object {
  return {
    get value() {
      return get();
    },
    set value(value: number) {
      set(value);
    },
  };
}

/** The values of a rule part as entries, or undefined for a part kept whole. */
function partEntries(game: Game, part: unknown): readonly object[] | undefined {
  if (part instanceof PlayerValues) {
    return game.players().map((p) =>
      valueEntry(
        () => part.get(p.id),
        (v) => {
          part.set(p.id, v);
        },
      ),
    );
  }
  if (part instanceof SlotValues) {
    return Array.from({ length: part.length }, (_, slot) =>
      valueEntry(
        () => part.get(slot),
        (v) => {
          part.set(slot, v);
        },
      ),
    );
  }
  if (part instanceof RecordList) return part.entries as object[];
  return undefined;
}

/** The entries of each entity of the game, by entity name. */
function entities(game: Game): Map<string, readonly object[]> {
  const out = new Map<string, readonly object[]>();
  out.set("player", game.players());
  out.set("game", [game]);
  for (const [name, value] of Object.entries(fields(game))) {
    if (Array.isArray(value) && !(name in NOT_STATE)) out.set(name, value as object[]);
  }
  for (const { name, part } of game.persistedParts()) {
    const entries = partEntries(game, part);
    if (entries) out.set(`part ${name}`, entries);
    else if (!Object.keys(WHOLE_PARTS).some((start) => name.startsWith(start))) {
      throw new Error(`part ${name} is neither read value by value nor kept whole`);
    }
  }
  return out;
}

/** The fields of an entry the test changes: for the game, its own numbers only. */
function keysOf(entity: string, entry: object): string[] {
  const keys = Object.keys(entry);
  if (entity !== "game") return keys;
  return keys.filter((key) => {
    const value = fields(entry)[key];
    return value === undefined || typeof value === "number";
  });
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Int32Array || Array.isArray(a)) {
    const left = Array.from(a as ArrayLike<number>);
    const right = b instanceof Int32Array || Array.isArray(b) ? Array.from(b) : undefined;
    return (
      right !== undefined && left.length === right.length && left.every((v, i) => v === right[i])
    );
  }
  return Object.is(a, b);
}

/** The exemptions that hold for this entry now, by their index in `EXEMPT`. */
function exemptions(game: Game, entity: string, key: string, entry: object): number[] {
  const out: number[] = [];
  EXEMPT.forEach((e, i) => {
    if (e.entity === entity && e.key === key && (e.when?.(game, fields(entry)) ?? true))
      out.push(i);
  });
  return out;
}

interface Run {
  /** Every field seen, as `entity.key`. */
  readonly seen: Set<string>;
  /** Every case checked, as `entity.key` and the exemptions that held (`-` for none). */
  readonly checked: Set<string>;
  readonly failures: string[];
}

/**
 * Plays a game and, at the first state each case can be checked in, changes
 * the field, checks the hash and a snapshot, and sets the field back.
 */
function check(fixture: Fixture): Run {
  const game = fixture.newGame();
  game.setupDigest();
  const run: Run = { seen: new Set(), checked: new Set(), failures: [] };
  const inspect = () => {
    for (const [entity, entries] of entities(game)) {
      entries.forEach((entry, index) => {
        for (const key of keysOf(entity, entry)) {
          run.seen.add(`${entity}.${key}`);
          const change = CHANGES[entity]?.[key];
          if (!change) continue;
          const held = exemptions(game, entity, key, entry);
          const name = `${entity}.${key} ${held.length === 0 ? "-" : held.join(",")}`;
          if (run.checked.has(name)) continue;
          const before = fields(entry)[key];
          const after = change(before, game);
          if (after === undefined) continue;
          run.checked.add(name);
          const where = `${fixture.name}: ${entity}[${String(index)}].${key} at ${String(game.tick)}`;
          const reference = game.hash();
          fields(entry)[key] = after;
          const hashed = game.hash() !== reference;
          const bytes = saveSnapshot(game, BUILD);
          fields(entry)[key] = before;
          if (game.hash() !== reference) run.failures.push(`${where}: not set back`);
          const loaded = loadSnapshot(bytes, BUILD, fixture.newGame);
          const copy = loaded.ok ? entities(loaded.game).get(entity)?.[index] : undefined;
          const carried = copy !== undefined && same(fields(copy)[key], after);
          const exempt = held.map((i) => (EXEMPT[i] as Exemption).from);
          const fromHash = exempt.includes("hash") || exempt.includes("both");
          const fromSnapshot = exempt.includes("snapshot") || exempt.includes("both");
          if (hashed === fromHash) {
            run.failures.push(`${where}: ${fromHash ? "hashed though exempt" : "not hashed"}`);
          }
          if (carried === fromSnapshot) {
            run.failures.push(`${where}: ${fromSnapshot ? "saved though exempt" : "not saved"}`);
          }
        }
      });
    }
  };
  inspect();
  while (game.tick < 1000) {
    game.step({ tick: game.tick, orders: fixture.orders(game) });
    inspect();
  }
  return run;
}

describe("the state", () => {
  const runs = [check(BUSY), check(ALL_RULES)];
  const seen = new Set(runs.flatMap((run) => [...run.seen]));
  const checked = new Set(runs.flatMap((run) => [...run.checked]));

  it("reaches the hash and snapshots in every field but the exempt ones", () => {
    expect(runs.flatMap((run) => run.failures)).toEqual([]);
  });

  it("has a change for every field of every entity, and none for a field that is gone", () => {
    const listed = Object.entries(CHANGES).flatMap(([entity, keys]) =>
      Object.keys(keys).map((key) => `${entity}.${key}`),
    );
    expect([...seen].filter((field) => !listed.includes(field))).toEqual([]);
    expect(listed.filter((field) => !seen.has(field))).toEqual([]);
  });

  it("checks every field outside its exemptions, and every exemption, in one game or the other", () => {
    const missing: string[] = [];
    for (const [entity, keys] of Object.entries(CHANGES)) {
      for (const key of Object.keys(keys)) {
        const always = EXEMPT.some((e) => e.entity === entity && e.key === key && !e.when);
        if (!always && !checked.has(`${entity}.${key} -`)) missing.push(`${entity}.${key}`);
      }
    }
    EXEMPT.forEach((e, i) => {
      const cases = [...checked].filter((c) => c.startsWith(`${e.entity}.${e.key} `));
      const used = cases.some((c) => (c.split(" ")[1] as string).split(",").includes(String(i)));
      if (!used) missing.push(`exemption ${e.entity}.${e.key} (${e.reason})`);
    });
    expect(missing).toEqual([]);
  });

  it("knows every array of the game, as an entity list or as what is not state", () => {
    const game = BUSY.newGame();
    const arrays = Object.keys(game).filter((name) => Array.isArray(fields(game)[name]));
    expect(arrays.filter((name) => !(name in CHANGES) && !(name in NOT_STATE))).toEqual([]);
    expect(Object.keys(NOT_STATE).filter((name) => !arrays.includes(name))).toEqual([]);
  });
});
