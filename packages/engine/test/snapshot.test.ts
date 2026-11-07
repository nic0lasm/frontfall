import { describe, expect, it } from "vitest";
import { createGame } from "../src/create-game.ts";
import type { Turn } from "../src/game.ts";
import {
  SNAPSHOT_MAX_BYTES,
  loadSnapshot,
  readSnapshotHeader,
  saveSnapshot,
} from "../src/snapshot.ts";
import {
  BUILD,
  balance,
  busyOrders as orders,
  newBusyGame as newGame,
  players,
  terrain,
} from "./fixtures/busy-game.ts";

const TICKS = 1000;
const AFTER = 500;

/** One game played from its start, with its turns, its hash after every tick and snapshots on the way. */
function played() {
  const game = newGame();
  const turns: Turn[] = [];
  const hashes: number[] = [];
  const snapshots = new Map<number, Uint8Array>();
  const seen = {
    trade: 0,
    warships: 0,
    missiles: 0,
    fallout: 0,
    boats: 0,
    alliances: 0,
    requests: 0,
    embargoes: 0,
    quick: 0,
    fights: 0,
  };
  while (game.tick < TICKS) {
    if (game.tick % 50 === 0) snapshots.set(game.tick, saveSnapshot(game, BUILD));
    const turn = { tick: game.tick, orders: orders(game) };
    turns.push(turn);
    game.step(turn);
    hashes.push(game.hash());
    seen.trade += game.tradeShips.length;
    seen.warships += game.warships.length;
    seen.missiles += game.missiles.length;
    seen.fallout += game.fallout.length;
    seen.boats += game.boats.length;
    seen.alliances += game.alliances.length;
    seen.requests += game.allianceRequests.length;
    seen.embargoes += game.embargoes.length;
    seen.quick += game.quickCooldowns.length;
    seen.fights += game.fights.length;
  }
  return { game, turns, hashes, snapshots, seen };
}

describe("snapshots (#39)", () => {
  const reference = played();

  it("come from a game where every rule with state is at work", () => {
    for (const [what, count] of Object.entries(reference.seen)) {
      expect(count, `${what} never in play`).toBeGreaterThan(0);
    }
  });

  it("load at any tick into a game that plays on to the same hashes (R-FAIR-01)", () => {
    for (const [tick, bytes] of reference.snapshots) {
      const loaded = loadSnapshot(bytes, BUILD, () => newGame());
      if (!loaded.ok) throw new Error(`tick ${String(tick)}: ${loaded.reason}`);
      const game = loaded.game;
      expect(game.tick).toBe(tick);
      expect(saveSnapshot(game, BUILD)).toEqual(bytes);
      while (game.tick < Math.min(TICKS, tick + AFTER)) {
        game.step(reference.turns[game.tick] as Turn);
        expect(game.hash(), `loaded at ${String(tick)}, tick ${String(game.tick)}`).toBe(
          reference.hashes[game.tick - 1],
        );
      }
    }
    // Replays several stretches of the game: past the default 5 s on a loaded runner.
  }, 30_000);

  it("say what they hold in a header read before the state", () => {
    const bytes = reference.snapshots.get(500) as Uint8Array;
    expect(readSnapshotHeader(bytes)).toEqual({
      format: 6,
      build: BUILD,
      setup: newGame().setupDigest(),
      tick: 500,
      hash: reference.hashes[499],
      check: expect.any(Number) as number,
    });
    expect(readSnapshotHeader(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("are refused, without throwing, by another build, setup or set of rules", () => {
    const bytes = reference.snapshots.get(300) as Uint8Array;
    const refused = (result: ReturnType<typeof loadSnapshot>) => (result.ok ? "" : result.reason);
    expect(refused(loadSnapshot(bytes, "other", () => newGame()))).toBe(
      "snapshot of build test, not other",
    );
    expect(refused(loadSnapshot(bytes, BUILD, () => newGame(4)))).toBe(
      "snapshot of another game setup",
    );
    const withoutBots = () => createGame({ terrain, seed: 3, players, balance });
    expect(refused(loadSnapshot(bytes, BUILD, withoutBots))).toBe("snapshot of other rules");
    const started = () => {
      const game = newGame();
      game.step({ tick: 0, orders: [] });
      return game;
    };
    expect(refused(loadSnapshot(bytes, BUILD, started))).toBe("the game has already started");
    expect(refused(loadSnapshot(new Uint8Array(SNAPSHOT_MAX_BYTES + 1), BUILD, newGame))).toBe(
      "snapshot too large",
    );
  });

  it("are refused, without throwing, when cut short or damaged", () => {
    const bytes = reference.snapshots.get(700) as Uint8Array;
    for (let length = 0; length < bytes.length; length += 97) {
      expect(loadSnapshot(bytes.subarray(0, length), BUILD, newGame).ok).toBe(false);
    }
    let seed = 1;
    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const damaged = bytes.slice();
      const at = seed % damaged.length;
      damaged[at] = (damaged[at] as number) ^ (1 + ((seed >>> 24) % 255));
      expect(loadSnapshot(damaged, BUILD, newGame).ok).toBe(false);
    }
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(loadSnapshot(longer, BUILD, newGame)).toEqual({ ok: false, reason: "damaged snapshot" });
  });
});
