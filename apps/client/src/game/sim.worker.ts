import type { Order, Turn } from "@frontfall/engine";
import { transferables, type WorkerReply, type WorkerRequest } from "./messages.ts";
import { fetchMapData } from "./maps.ts";
import { SoloGame } from "./solo-game.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

let game: SoloGame | undefined;
let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
let paused = false;
let pending: Order[] = [];
/** Online games advance with the server's turns, never with a clock of their own. */
let online = false;
/** Turns that arrive while the map still loads, played as soon as it is ready. */
let early: Turn[] = [];

function tick(): void {
  if (!game || paused) return;
  const orders = pending;
  pending = [];
  const update = game.step(orders);
  // The game goes on once decided, for a player who keeps watching (R-WIN-03).
  scope.postMessage({ type: "update", update }, transferables(update));
}

function playTurns(turns: Turn[]): void {
  if (!game || turns.length === 0) return;
  const update = game.playTurns(turns);
  scope.postMessage({ type: "update", update }, transferables(update));
}

async function start(request: Extract<WorkerRequest, { type: "start" }>): Promise<void> {
  // One game per worker: a second start would run two clocks on one game.
  if (started) throw new Error("the game has already started");
  started = true;
  online = request.online === true;
  const map = await fetchMapData(request.map);
  game = new SoloGame(request.options, map);
  const {
    ticksPerSecond,
    winSharePercent,
    maxDurationTicks,
    retreatPenaltyPercent,
    allianceRequestTicks,
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
        allianceRequestTicks,
      },
    },
    [view.kinds.buffer, view.relief.buffer],
  );
  if (online) {
    playTurns(early);
    early = [];
    return;
  }
  const speed = Math.max(1, Math.floor(request.options.speed ?? 1));
  timer = setInterval(() => {
    for (let i = 0; i < speed; i++) tick();
  }, 1000 / ticksPerSecond);
}

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "start":
      start(request).catch((error: unknown) => {
        scope.postMessage({ type: "error", message: String(error) });
      });
      break;
    case "order":
      pending.push(request.order);
      break;
    case "click": {
      if (!game) break;
      const result = game.orderForClick(request.tile, request.ratio, request.mode);
      if ("order" in result) {
        if (online) {
          scope.postMessage({
            type: "click",
            tile: request.tile,
            outcome: result.order.type,
            order: result.order,
          });
          break;
        }
        pending.push(result.order);
      }
      const outcome = "order" in result ? result.order.type : result.refused;
      scope.postMessage({ type: "click", tile: request.tile, outcome });
      break;
    }
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
    case "pause":
      paused = request.paused;
      break;
    case "stop":
      clearInterval(timer);
      timer = undefined;
      game = undefined;
      break;
  }
};
