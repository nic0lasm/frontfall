import type { Turn } from "@frontfall/engine";
import type { GameSnapshot, SoloOptions } from "./game-runner.ts";
import type { GameFacts } from "../usage.ts";

/**
 * The last snapshot of the online game this browser plays (#39), kept in
 * IndexedDB: after a reload, the game starts from it and the server sends
 * only the turns since, instead of every turn from the first.
 */
export interface StoredSnapshot {
  game: string;
  tick: number;
  bytes: Uint8Array;
  /** Every turn with orders up to `tick`, for the record of the game and desync reports. */
  history: Turn[];
}

const DATABASE = "frontfall";
const STORE = "snapshots";
/** One game at a time: the entry of the game played last. */
const KEY = "current";
/** The solo game in progress, apart from the online one. */
const SOLO_KEY = "solo";

/** A solo game in progress, kept so that a reload or a closed tab can take it back. */
export interface SoloSave extends GameSnapshot {
  /** Options the game started with, its snapshot aside. */
  options: Omit<SoloOptions, "snapshot">;
  /** What its usage report says of it. */
  facts: Omit<GameFacts, "view">;
  /** When it was kept, by the page's clock. */
  savedAt: number;
}

function open(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        if (database.objectStoreNames.contains(STORE)) {
          resolve(database);
          return;
        }
        // A database of this name without the store: made again on the next call.
        database.close();
        indexedDB.deleteDatabase(DATABASE);
        resolve(undefined);
      };
      // Blocked, refused or unavailable, as in some private windows: no snapshot.
      request.onerror = () => {
        resolve(undefined);
      };
      request.onblocked = () => {
        resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
}

/** Runs one request on the store; undefined if storage is unavailable or the request fails. */
async function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const database = await open();
  if (!database) return undefined;
  return new Promise((resolve) => {
    try {
      const request = body(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => {
        resolve(request.result);
        database.close();
      };
      request.onerror = () => {
        resolve(undefined);
        database.close();
      };
    } catch {
      resolve(undefined);
      database.close();
    }
  });
}

/** How long a reload waits for the snapshot before it asks for every turn instead. */
const READ_TIMEOUT_MS = 2_000;

/** The snapshot kept of `game`, if this browser has one. */
export async function storedSnapshot(game: string): Promise<StoredSnapshot | undefined> {
  const entry = (await Promise.race([
    run("readonly", (store) => store.get(KEY)),
    new Promise<undefined>((resolve) => setTimeout(resolve, READ_TIMEOUT_MS)),
  ])) as Partial<StoredSnapshot> | undefined;
  if (
    entry?.game !== game ||
    !(entry.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(entry.tick) ||
    !Array.isArray(entry.history)
  ) {
    return undefined;
  }
  return entry as StoredSnapshot;
}

/** Keeps a snapshot in place of the one before, whatever game it was of. */
export async function storeSnapshot(snapshot: StoredSnapshot): Promise<void> {
  await run("readwrite", (store) => store.put(snapshot, KEY));
}

/** Forgets the snapshot: the game is over, left, or no longer matches the other players'. */
export async function forgetSnapshot(): Promise<void> {
  await run("readwrite", (store) => store.delete(KEY));
}

/** The solo game in progress kept by this browser, if any. */
export async function storedSoloGame(): Promise<SoloSave | undefined> {
  const entry = (await Promise.race([
    run("readonly", (store) => store.get(SOLO_KEY)),
    new Promise<undefined>((resolve) => setTimeout(resolve, READ_TIMEOUT_MS)),
  ])) as Partial<SoloSave> | undefined;
  if (
    !(entry?.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(entry.tick) ||
    !Number.isFinite(entry.savedAt) ||
    !Array.isArray(entry.history) ||
    typeof entry.options?.map !== "string" ||
    typeof entry.facts?.mode !== "string"
  ) {
    return undefined;
  }
  return entry as SoloSave;
}

/** Keeps the solo game in progress in place of the one before. */
export async function storeSoloGame(save: SoloSave): Promise<void> {
  await run("readwrite", (store) => store.put(save, SOLO_KEY));
}

/** Forgets the solo game: it ended, was left, or another one began. */
export async function forgetSoloGame(): Promise<void> {
  await run("readwrite", (store) => store.delete(SOLO_KEY));
}
