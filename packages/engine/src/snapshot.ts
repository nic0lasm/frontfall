import type { Game } from "./game.ts";
import type { MissileSize } from "./missiles.ts";
import { SnapshotError, SnapshotReader, SnapshotWriter, checksum } from "./snapshot-bytes.ts";
import type { StructureKind } from "./structures.ts";

/** Version of the snapshot format of docs/engine.md; a reader refuses any other. */
export const SNAPSHOT_FORMAT = 3;

/**
 * Most bytes a snapshot may take. The state grows with the map and how
 * divided it is, not with time: on World, snapshots of whole games with 16
 * bots stay under 110 KB, and under 170 KB with the 64 nations added.
 */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024;

/** "FFSN": what a snapshot starts with, so another file is refused on its first bytes. */
const MAGIC = [0x46, 0x46, 0x53, 0x4e] as const;

/** What a snapshot says about itself, read before any of the state. */
export interface SnapshotHeader {
  format: number;
  /** Build of the simulation that wrote it; only the same build loads it. */
  build: string;
  /** `setupDigest()` of the game it was taken from. */
  setup: number;
  /** Ticks the game had run; the next turn to play is this one. */
  tick: number;
  /** State hash of the game at that tick, which the loaded game must have. */
  hash: number;
  /** `checksum` of the state's bytes, which follow the header. */
  check: number;
}

export type LoadedSnapshot = { ok: true; game: Game } | { ok: false; reason: string };

/**
 * The whole state of a game between two ticks (#39), in the binary format
 * of docs/engine.md. `build` names the simulation that runs it: a client's
 * BUILD, the same on every runtime of a release.
 */
export function saveSnapshot(game: Game, build: string): Uint8Array {
  const out = new SnapshotWriter();
  for (const byte of MAGIC) out.uint(byte);
  out.uint(SNAPSHOT_FORMAT);
  out.text(build);
  out.word(game.setupDigest());
  out.uint(game.tick);
  out.word(game.hash());
  const state = new SnapshotWriter();
  writeState(game, state);
  const bytes = state.finish();
  out.word(checksum(bytes));
  out.raw(bytes);
  return out.finish();
}

/**
 * The header of a snapshot, or undefined if the bytes are not one of this
 * format. Reads nothing of the state.
 */
export function readSnapshotHeader(bytes: Uint8Array): SnapshotHeader | undefined {
  try {
    return header(new SnapshotReader(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Loads a snapshot into the game `create` returns, which must be new and set
 * up like the one it was taken from: same setup, same rules, same bots and
 * nations. The build, the setup and the rules are checked before any of the
 * state is read, and the loaded state must hash as the saved one did.
 * Never throws: a snapshot that cannot be loaded comes back with the reason,
 * and the caller plays the turns from the start instead.
 */
export function loadSnapshot(bytes: Uint8Array, build: string, create: () => Game): LoadedSnapshot {
  try {
    if (bytes.length > SNAPSHOT_MAX_BYTES) return refuse("snapshot too large");
    const from = new SnapshotReader(bytes);
    const head = header(from);
    if (!head) return refuse("not a snapshot of this format");
    if (head.build !== build) return refuse(`snapshot of build ${head.build}, not ${build}`);
    const game = create();
    if (game.tick !== 0) return refuse("the game has already started");
    if (game.setupDigest() !== head.setup) return refuse("snapshot of another game setup");
    const bytesOfState = from.rest();
    if (checksum(bytesOfState) !== head.check) return refuse("damaged snapshot");
    const state = new SnapshotReader(bytesOfState);
    readState(game, head.tick, state);
    if (!state.done) return refuse("bytes after the end of the state");
    if (game.hash() !== head.hash) return refuse("loaded state does not hash as saved");
    return { ok: true, game };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "unreadable snapshot");
  }
}

function refuse(reason: string): LoadedSnapshot {
  return { ok: false, reason };
}

function header(from: SnapshotReader): SnapshotHeader | undefined {
  for (const byte of MAGIC) if (from.uint() !== byte) return undefined;
  const format = from.uint();
  if (format !== SNAPSHOT_FORMAT) return undefined;
  const build = from.text();
  const setup = from.word();
  const tick = from.uint();
  return { format, build, setup, tick, hash: from.word(), check: from.word() };
}

function writeState(game: Game, out: SnapshotWriter): void {
  // As they are: the generator keeps some words signed, and the state hash sees the difference.
  for (const word of game.random.state()) out.int(word);
  for (const p of game.players()) {
    out.int(p.troops);
    out.int(p.gold);
    out.int(p.goldRemainder);
    out.uint(p.workShare);
    out.uint(p.alive ? 1 : 0);
    out.int(p.start ?? -1);
    out.uint(p.traitorUntil);
  }

  const { territory } = game;
  writeRuns(out, territory.owners);
  for (let player = 1; player <= territory.maxPlayers; player++) {
    const count = territory.borderCount(player);
    out.uint(count);
    for (let i = 0; i < count; i++) out.uint(territory.borderTile(player, i));
  }
  writeRuns(out, game.falloutUntil);

  out.uint(game.nextAttackId);
  out.uint(game.attacks.length);
  for (const a of game.attacks) {
    for (const value of [a.id, a.player, a.target, a.aim, a.troops]) out.uint(value);
    if (game.rules.collapsingFronts) out.uint(a.pressure);
  }
  out.uint(game.nextBoatId);
  out.uint(game.boats.length);
  for (const b of game.boats) {
    for (const value of [b.id, b.player, b.target, b.troops, b.step]) out.uint(value);
    out.path(b.path);
  }
  out.uint(game.nextStructureId);
  out.uint(game.structures.length);
  for (const s of game.structures) {
    for (const value of [s.id, s.player, s.kind, s.tile, s.readyAt, s.reloadAt]) out.uint(value);
  }
  out.uint(game.nextTradeShipId);
  out.uint(game.tradeShips.length);
  for (const t of game.tradeShips) {
    for (const value of [t.id, t.player, t.port, t.from, t.to, t.step]) out.uint(value);
    out.path(t.path);
  }
  out.uint(game.nextWarshipId);
  out.uint(game.warships.length);
  for (const w of game.warships) {
    for (const value of [w.id, w.player, w.tile, w.health, w.patrol, w.step, w.reloadAt]) {
      out.uint(value);
    }
    out.path(w.path);
  }
  out.uint(game.nextMissileId);
  out.uint(game.missiles.length);
  for (const m of game.missiles) {
    for (const value of [m.id, m.player, m.size, m.from, m.to, m.launchedAt, m.arrivesAt]) {
      out.uint(value);
    }
    out.uint(m.tried.length);
    for (const id of m.tried) out.uint(id);
  }
  out.uint(game.fallout.length);
  for (const f of game.fallout) for (const value of [f.tile, f.radius, f.until]) out.uint(value);
  out.uint(game.fights.length);
  for (const f of game.fights) for (const value of [f.a, f.b, f.until]) out.uint(value);
  out.uint(game.alliances.length);
  for (const a of game.alliances) {
    for (const value of [a.a, a.b, a.until, a.renewA ? 1 : 0, a.renewB ? 1 : 0]) out.uint(value);
  }
  out.uint(game.allianceRequests.length);
  for (const r of game.allianceRequests) {
    for (const value of [r.from, r.to, r.expiresAt]) out.uint(value);
  }
  out.uint(game.requestCooldowns.length);
  for (const c of game.requestCooldowns)
    for (const value of [c.from, c.to, c.until]) out.uint(value);
  out.uint(game.embargoes.length);
  for (const e of game.embargoes) for (const value of [e.from, e.to, e.since]) out.uint(value);
  out.uint(game.quickCooldowns.length);
  for (const c of game.quickCooldowns) for (const value of [c.player, c.until]) out.uint(value);
  out.int(game.winner ?? -1);
  out.int(game.winningTeam ?? -1);
  out.int(game.decidedAt ?? -1);

  const parts = game.persistedParts();
  out.uint(parts.length);
  for (const { name, part } of parts) {
    out.text(name);
    const inner = new SnapshotWriter();
    part.save(inner);
    out.blob(inner.finish());
  }
}

function readState(game: Game, tick: number, from: SnapshotReader): void {
  const size = game.terrain.topology.size;
  const { territory } = game;
  const tile = (): number => from.below(size, "tile");
  const player = (): number => from.below(territory.maxPlayers + 1, "player");
  const id = (): number => from.uint();
  const optional = (): number | undefined => {
    const value = from.int();
    if (value < -1) throw new SnapshotError("value out of range");
    return value === -1 ? undefined : value;
  };

  game.restoreTick(tick);
  const word = (): number => {
    const value = from.int();
    if (value < -(2 ** 31) || value >= 2 ** 32)
      throw new SnapshotError("random state out of range");
    return value;
  };
  game.random.restore([word(), word(), word(), word()]);
  for (const p of game.players()) {
    p.troops = from.int();
    p.gold = from.int();
    p.goldRemainder = from.int();
    p.workShare = from.below(game.balance.workMaxPercent + 1, "work share");
    p.alive = from.below(2, "alive") === 1;
    const start = optional();
    if (start !== undefined && start >= size) throw new SnapshotError("start out of range");
    p.start = start;
    p.traitorUntil = from.uint();
  }

  const owners = new Uint16Array(size);
  readRuns(from, owners, territory.maxPlayers + 1);
  const borders: Int32Array[] = [];
  for (let p = 1; p <= territory.maxPlayers; p++) {
    const list = new Int32Array(from.count());
    for (let i = 0; i < list.length; i++) list[i] = tile();
    borders.push(list);
  }
  territory.restore(owners, borders);
  readRuns(from, game.falloutUntil, 2 ** 32);

  game.nextAttackId = id();
  for (let n = from.count(); n > 0; n--) {
    const [attackId, owner, target, aim, troops] = [id(), player(), player(), tile(), id()];
    const pressure = game.rules.collapsingFronts ? id() : 0;
    game.attacks.push({ id: attackId, player: owner, target, aim, troops, pressure });
  }
  game.nextBoatId = id();
  for (let n = from.count(); n > 0; n--) {
    const [boatId, owner, target, troops, step] = [id(), player(), tile(), id(), id()];
    game.boats.push({ id: boatId, player: owner, target, troops, step, path: from.path(size) });
  }
  game.nextStructureId = id();
  for (let n = from.count(); n > 0; n--) {
    game.structures.push({
      id: id(),
      player: player(),
      kind: from.below(6, "structure kind") as StructureKind,
      tile: tile(),
      readyAt: id(),
      reloadAt: id(),
    });
  }
  game.nextTradeShipId = id();
  for (let n = from.count(); n > 0; n--) {
    const [shipId, owner, port, start, end, step] = [id(), player(), id(), tile(), tile(), id()];
    game.tradeShips.push({
      id: shipId,
      player: owner,
      port,
      from: start,
      to: end,
      step,
      path: from.path(size),
    });
  }
  game.nextWarshipId = id();
  for (let n = from.count(); n > 0; n--) {
    const [shipId, owner, at, health, patrol, step, reloadAt] = [
      id(),
      player(),
      tile(),
      id(),
      tile(),
      id(),
      id(),
    ];
    game.warships.push({
      id: shipId,
      player: owner,
      tile: at,
      health,
      patrol,
      step,
      reloadAt,
      path: from.path(size),
    });
  }
  game.nextMissileId = id();
  for (let n = from.count(); n > 0; n--) {
    const missile = {
      id: id(),
      player: player(),
      size: from.below(2, "missile size") as MissileSize,
      from: tile(),
      to: tile(),
      launchedAt: id(),
      arrivesAt: id(),
      tried: [] as number[],
    };
    for (let t = from.count(); t > 0; t--) missile.tried.push(id());
    game.missiles.push(missile);
  }
  for (let n = from.count(); n > 0; n--) {
    game.fallout.push({ tile: tile(), radius: id(), until: id() });
  }
  for (let n = from.count(); n > 0; n--) {
    game.fights.push({ a: player(), b: player(), until: id() });
  }
  for (let n = from.count(); n > 0; n--) {
    game.alliances.push({
      a: player(),
      b: player(),
      until: id(),
      renewA: from.below(2, "renewal") === 1,
      renewB: from.below(2, "renewal") === 1,
    });
  }
  for (let n = from.count(); n > 0; n--) {
    game.allianceRequests.push({ from: player(), to: player(), expiresAt: id() });
  }
  for (let n = from.count(); n > 0; n--) {
    game.requestCooldowns.push({ from: player(), to: player(), until: id() });
  }
  for (let n = from.count(); n > 0; n--) {
    game.embargoes.push({ from: player(), to: player(), since: id() });
  }
  for (let n = from.count(); n > 0; n--) {
    game.quickCooldowns.push({ player: player(), until: id() });
  }
  game.winner = optional();
  game.winningTeam = optional();
  game.decidedAt = optional();

  const parts = game.persistedParts();
  if (from.uint() !== parts.length) throw new SnapshotError("snapshot of other rules");
  for (const { name, part } of parts) {
    if (from.text() !== name) throw new SnapshotError("snapshot of other rules");
    const inner = new SnapshotReader(from.blob());
    part.load(inner);
    if (!inner.done) throw new SnapshotError(`bytes after the end of part ${name}`);
  }
}

/** An array as runs of equal values: land and sea come in long stretches. */
function writeRuns(out: SnapshotWriter, values: Uint16Array | Uint32Array): void {
  const runs: number[] = [];
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === values[start]) continue;
    runs.push(values[start] as number, i - start);
    start = i;
  }
  out.uint(runs.length / 2);
  for (const value of runs) out.uint(value);
}

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
