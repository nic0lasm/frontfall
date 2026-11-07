import type { Game } from "./game.ts";
import { SnapshotReader, SnapshotWriter, checksum } from "./snapshot-bytes.ts";
import { readState, writeState } from "./state/layout.ts";

/** Version of the snapshot format of docs/engine.md; a reader refuses any other. */
export const SNAPSHOT_FORMAT = 6;

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
