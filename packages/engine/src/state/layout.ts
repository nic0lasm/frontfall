import type { Game } from "../game.ts";
import { SnapshotError, type SnapshotReader } from "../snapshot-bytes.ts";
import { optional, readInto, readList, tile, writeList, writeRecord, type Codec } from "./codec.ts";
import { writable, type GameLists } from "./lists.ts";
import {
  ALLIANCE_RECORD,
  ALLIANCE_REQUEST_RECORD,
  ATTACK_RECORD,
  BOAT_RECORD,
  EMBARGO_RECORD,
  FALLOUT_RECORD,
  FIGHT_RECORD,
  MISSILE_RECORD,
  PLAYER_RECORD,
  QUICK_COOLDOWN_RECORD,
  REQUEST_COOLDOWN_RECORD,
  STRUCTURE_RECORD,
  TRADE_SHIP_RECORD,
  WARSHIP_RECORD,
} from "./records.ts";
import type { StateWriter } from "./writer.ts";

/*
 * The order of the state (docs/engine.md, ADR 0008): what a snapshot holds
 * after its header, and what the state hash mixes after the tick and the
 * setup, value for value. The writer and the reader below are the only two
 * places that order is written.
 */

/** The game's own counters of ids, which come before the list they number. */
type NextId =
  | "nextAttackId"
  | "nextBoatId"
  | "nextStructureId"
  | "nextTradeShipId"
  | "nextWarshipId"
  | "nextMissileId";

interface ListLayout {
  readonly list: keyof GameLists;
  /** The codec of the list's records, which `layout` matched to the list. */
  readonly codec: Codec<object>;
  readonly next?: NextId;
}

function layout<K extends keyof GameLists>(
  list: K,
  codec: Codec<GameLists[K][number]>,
  next?: NextId,
): ListLayout {
  const erased = codec as unknown as Codec<object>;
  return next === undefined ? { list, codec: erased } : { list, codec: erased, next };
}

/**
 * The entity lists in the order the state holds them, each behind the
 * counter of its ids when it has one. Their records follow their codecs
 * (state/records.ts).
 */
const LISTS: readonly ListLayout[] = [
  layout("attacks", ATTACK_RECORD, "nextAttackId"),
  layout("boats", BOAT_RECORD, "nextBoatId"),
  layout("structures", STRUCTURE_RECORD, "nextStructureId"),
  layout("tradeShips", TRADE_SHIP_RECORD, "nextTradeShipId"),
  layout("warships", WARSHIP_RECORD, "nextWarshipId"),
  layout("missiles", MISSILE_RECORD, "nextMissileId"),
  layout("fallout", FALLOUT_RECORD),
  layout("fights", FIGHT_RECORD),
  layout("alliances", ALLIANCE_RECORD),
  layout("allianceRequests", ALLIANCE_REQUEST_RECORD),
  layout("requestCooldowns", REQUEST_COOLDOWN_RECORD),
  layout("embargoes", EMBARGO_RECORD),
  layout("quickCooldowns", QUICK_COOLDOWN_RECORD),
];

/**
 * Writes the whole state: the random state, the players, the map's owners,
 * borders and fallout, the entity lists, the outcome, then the rule parts
 * by name in the order they were registered.
 */
export function writeState(game: Game, out: StateWriter): void {
  // As they are: the generator keeps some words signed, and the state hash sees the difference.
  for (const word of game.random.state()) out.int(word);
  for (const p of game.players()) writeRecord(out, PLAYER_RECORD, p, game);

  const { territory } = game;
  out.tiles(territory.owners);
  for (let player = 1; player <= territory.maxPlayers; player++) {
    const count = territory.borderCount(player);
    out.uint(count);
    for (let i = 0; i < count; i++) out.uint(territory.borderTile(player, i));
  }
  // Above the tick, it follows from the fallout zones and the terrain, which are hashed.
  out.derivedTiles(game.falloutUntil);

  for (const { list, codec, next } of LISTS) {
    if (next !== undefined) out.uint(game[next]);
    writeList(out, codec, game[list] as readonly object[], game);
  }
  out.int(game.winner ?? -1);
  out.int(game.winningTeam ?? -1);
  out.int(game.decidedAt ?? -1);

  const parts = game.persistedParts();
  out.uint(parts.length);
  for (const { name, part } of parts) {
    out.text(name);
    out.section((inner) => {
      part.save(inner);
    });
  }
}

/** Reads what `writeState` wrote into a new game set up like the one it came from, at `tick`. */
export function readState(game: Game, tick: number, from: SnapshotReader): void {
  const size = game.terrain.topology.size;
  const { territory } = game;

  game.restoreTick(tick);
  const word = (): number => {
    const value = from.int();
    if (value < -(2 ** 31) || value >= 2 ** 32)
      throw new SnapshotError("random state out of range");
    return value;
  };
  game.random.restore([word(), word(), word(), word()]);
  for (const p of game.players()) readInto(from, PLAYER_RECORD, p, game);

  const owners = new Uint16Array(size);
  readRuns(from, owners, territory.maxPlayers + 1);
  const borders: Int32Array[] = [];
  for (let p = 1; p <= territory.maxPlayers; p++) {
    const list = new Int32Array(from.count());
    for (let i = 0; i < list.length; i++) list[i] = tile.read(from, game);
    borders.push(list);
  }
  territory.restore(owners, borders);
  readRuns(from, game.falloutUntil, 2 ** 32);

  // The loader is the one module besides their owners that writes the lists (ADR 0010).
  for (const { list, codec, next } of LISTS) {
    if (next !== undefined) game[next] = from.uint();
    readList(from, codec, writable(game, list) as object[], game);
  }
  game.winner = optional.read(from, game);
  game.winningTeam = optional.read(from, game);
  game.decidedAt = optional.read(from, game);

  // After the lists: a part kept by list slot checks its length against its list.
  const parts = game.persistedParts();
  if (from.uint() !== parts.length) throw new SnapshotError("snapshot of other rules");
  for (const { name, part } of parts) {
    if (from.text() !== name) throw new SnapshotError("snapshot of other rules");
    const inner = from.section();
    part.load(inner);
    if (!inner.done) throw new SnapshotError(`bytes after the end of part ${name}`);
  }
}

/** Reads the runs `StateWriter.tiles` wrote into a snapshot, each value below `limit`. */
function readRuns(from: SnapshotReader, into: Uint16Array | Uint32Array, limit: number): void {
  let at = 0;
  for (let n = from.count(); n > 0; n--) {
    const value = from.below(limit, "value");
    const length = from.uint();
    if (length === 0 || length > into.length - at) throw new SnapshotError("runs do not fit");
    into.fill(value, at, at + length);
    at += length;
  }
  if (at !== into.length) throw new SnapshotError("runs do not fit");
}
