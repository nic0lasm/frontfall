import type { Order, Turn } from "@frontfall/engine";
import { transferables, type WorkerReply, type WorkerRequest } from "./messages.ts";
import { fetchMapData } from "./maps.ts";
import { BeatClock } from "./beat-clock.ts";
import { REPLAY_MAP_CHANGED, REPLAY_SPEEDS, sameReplayMap } from "./replay-rules.ts";
import { SoloGame } from "./solo-game.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

/**
 * Ticks between two snapshots of an online game (#39): the first after 30
 * seconds, past the spawn phase, then every two minutes.
 */
const FIRST_SNAPSHOT_TICKS = 300;
const SNAPSHOT_TICKS = 1200;
/**
 * Solo, the page keeps the game for a reload with nobody to replay the
 * turns since: a snapshot every 30 seconds, the first after 3 seconds so
 * that a reload at the very start (the tutorial's, say) finds the game, and
 * one whenever the page goes to the background.
 */
const SOLO_FIRST_SNAPSHOT_TICKS = 30;
const SOLO_SNAPSHOT_TICKS = 300;

/** Fastest a replay runs, in ticks per beat. */
const MAX_SPEED = Math.max(...REPLAY_SPEEDS);

let game: SoloGame | undefined;
let started = false;
let clock: BeatClock | undefined;
let paused = false;
/** Ticks run per beat of the clock. */
let speed = 1;
let pending: Order[] = [];
/** Online games advance with the server's turns, never with a clock of their own. */
let online = false;
/** Turns that arrive while the map still loads, played as soon as it is ready. */
let early: Turn[] = [];
/** Tick after which the worker sends the page its next snapshot. */
let nextSnapshot = FIRST_SNAPSHOT_TICKS;
/** The game could not start from its snapshot: turns before its first tick comes again are dropped. */
let replayFromStart = false;
/** Solo: snapshots go to the page, for it to keep the game across a reload. */
let keepSolo = false;

function sendSnapshot(): void {
  if (!game) return;
  const snapshot = game.snapshot();
  scope.postMessage({ type: "snapshot", snapshot }, [snapshot.bytes.buffer as ArrayBuffer]);
}

function tick(): void {
  if (!game || paused) return;
  if (game.options.record) {
    const update = game.replay(speed);
    scope.postMessage({ type: "update", update }, transferables(update));
    // The last tick of the record: nothing more to play.
    if (update.replay?.hash !== undefined) clock?.stop();
    return;
  }
  const orders = pending;
  pending = [];
  const decided = game.winner !== undefined;
  const update = game.step(orders);
  // The game goes on once decided, for a player who keeps watching (R-WIN-03),
  // but waits behind the end screen until then: the record ends with the game,
  // even when the beat that decided it had more ticks to run.
  if (!decided && update.winner !== undefined && !online) paused = true;
  scope.postMessage({ type: "update", update }, transferables(update));
  // A decided game is not kept: a reload goes back to the menu.
  if (keepSolo && update.winner === undefined && game.game.tick >= nextSnapshot) {
    nextSnapshot = game.game.tick + SOLO_SNAPSHOT_TICKS;
    sendSnapshot();
  }
}

function playTurns(turns: Turn[]): void {
  if (!game) return;
  if (replayFromStart) {
    // Turns after the refused snapshot, sent before the page asked for every turn again.
    if (turns[0]?.tick !== game.game.tick) return;
    replayFromStart = false;
  }
  if (turns.length === 0) return;
  const update = game.playTurns(turns);
  scope.postMessage({ type: "update", update }, transferables(update));
  if (game.game.tick >= nextSnapshot) {
    nextSnapshot = game.game.tick + SNAPSHOT_TICKS;
    sendSnapshot();
  }
}

async function start(request: Extract<WorkerRequest, { type: "start" }>): Promise<void> {
  // One game per worker: a second start would run two clocks on one game.
  if (started) throw new Error("the game has already started");
  started = true;
  online = request.online === true;
  const map = await fetchMapData(request.map, request.manifest);
  const record = request.options.record;
  // The map of a replay must be the one its game was played on, terrain and nations.
  if (record && !sameReplayMap(record.map, map.source)) throw new Error(REPLAY_MAP_CHANGED);
  game = new SoloGame(request.options, map);
  const {
    ticksPerSecond,
    winSharePercent,
    maxDurationTicks,
    retreatPenaltyPercent,
    allianceRequestTicks,
    growthFloorPercent,
  } = game.game.balance;
  // The page draws the terrain too: it gets its own copy of the kinds, and
  // the relief, which only drawing uses.
  const view = { ...map, kinds: map.kinds.slice() };
  scope.postMessage(
    {
      type: "started",
      map: view,
      you: game.you,
      maxPlayer: Math.max(...game.game.players().map((player) => player.id)),
      rules: {
        ownableTiles: game.ownableTiles,
        ticksPerSecond,
        winSharePercent,
        maxDurationTicks,
        retreatPenaltyPercent,
        firstNation: game.firstNation,
        teams: game.teamsById(),
        disabled: game.game.disabled,
        special: game.game.rules,
        goldBonus: game.game.goldBonus,
        allianceRequestTicks,
        growthFloorPercent,
      },
    },
    [view.kinds.buffer, view.relief.buffer],
  );
  if (online) {
    // A game started from a snapshot has one already.
    if (game.game.tick > 0) nextSnapshot = game.game.tick + SNAPSHOT_TICKS;
    if (game.snapshotRefused !== undefined) {
      replayFromStart = true;
      scope.postMessage({ type: "snapshotRefused", reason: game.snapshotRefused });
    }
    playTurns(early);
    early = [];
    return;
  }
  keepSolo = request.keep === true && !record;
  if (keepSolo) {
    nextSnapshot =
      game.game.tick > 0 ? game.game.tick + SOLO_SNAPSHOT_TICKS : SOLO_FIRST_SNAPSHOT_TICKS;
  }
  if (game.snapshotRefused !== undefined) {
    scope.postMessage({ type: "snapshotRefused", reason: game.snapshotRefused });
  }
  speed = Math.max(1, Math.floor(request.options.speed ?? 1));
  clock = new BeatClock(() => {
    // A replay runs its ticks in one go, so that its update covers them all.
    if (game?.options.record) tick();
    else for (let i = 0; i < speed; i++) tick();
  }, 1000 / ticksPerSecond);
  clock.start();
}

/** Solo: the player's order plays at once rather than at the next beat (beat-clock.ts). */
function hurry(): void {
  if (!paused && !game?.options.record) clock?.pull();
}

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "start":
      start(request).catch((error: unknown) => {
        scope.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    case "order":
      pending.push(request.order);
      hurry();
      break;
    case "click": {
      if (!game) break;
      const result = game.orderForClick(request.tile, request.ratio, request.mode, request.reach);
      if ("order" in result) {
        if (online) {
          scope.postMessage({
            type: "click",
            tile: request.tile,
            outcome: result.order.type,
            order: result.order,
            ...(result.note ? { note: result.note } : {}),
          });
          break;
        }
        pending.push(result.order);
      }
      const outcome = "order" in result ? result.order.type : result.refused;
      const note = "order" in result ? result.note : undefined;
      scope.postMessage({ type: "click", tile: request.tile, outcome, ...(note ? { note } : {}) });
      if ("order" in result) hurry();
      break;
    }
    case "peek":
      if (game) {
        const { seq, tile, mode, reach } = request;
        scope.postMessage({ type: "peek", seq, ...game.previewClick(tile, mode, reach) });
      }
      break;
    case "turns":
      if (game) playTurns(request.turns);
      else early.push(...request.turns);
      break;
    case "desync":
      game?.desync(request.tick, request.expected);
      break;
    case "report":
      scope.postMessage({ type: "report", report: game?.report() });
      break;
    case "record":
      scope.postMessage({ type: "record", record: game?.record() });
      break;
    case "snapshot":
      if (keepSolo && game && game.winner === undefined) {
        nextSnapshot = game.game.tick + SOLO_SNAPSHOT_TICKS;
        sendSnapshot();
      }
      break;
    case "speed":
      speed = Math.max(1, Math.min(MAX_SPEED, Math.floor(request.speed)));
      break;
    case "pause":
      paused = request.paused;
      break;
    case "stop":
      clock?.stop();
      clock = undefined;
      game = undefined;
      break;
  }
};
