import type { Socket } from "node:net";
import {
  encodeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  TICK_RATE,
  type ClientMessage,
  type Order,
  type ServerMessage,
} from "@frontfall/protocol";
import WebSocket from "ws";
import { Histogram, type HistogramData } from "./histogram.ts";

/** Interval the server closes turns at. */
export const TURN_MS = 1000 / TICK_RATE;

/** Clients send a state hash every this many ticks, like the real client. */
const HASH_EVERY = 50;

/** A `rejoin` answered `token_in_use` is sent again after this long, as the protocol asks. */
const REJOIN_RETRY_MS = 1000;
const REJOIN_ATTEMPTS = 10;

/** What the clients of one game measured, as plain JSON. */
export interface GameData {
  id: string;
  intervals: HistogramData;
  orderLatency: HistogramData;
  outOfOrder: number;
  changedTurns: number;
  desyncs: number;
  ordersSent: number;
  ordersSeen: number;
  turnsPerClient: number[];
}

/** What every client of one game measured. Shared by the clients of the game. */
export class GameStats {
  /** Time between two consecutive turn frames on one client. */
  readonly intervals = new Histogram();
  /** Time from sending an order to receiving the turn that holds it. */
  readonly orderLatency = new Histogram();
  /** Frames whose first tick was not the one after the previous frame. */
  outOfOrder = 0;
  /** Turns that a client received with other orders than an earlier client, or itself before a rejoin. */
  changedTurns = 0;
  desyncs = 0;
  ordersSent = 0;
  ordersSeen = 0;
  /** Turns each client had received when the run stopped. */
  readonly turnsPerClient: number[] = [];
  /** A hash of the orders of every tick, as the first client to receive it saw them. */
  private readonly turnHashes: number[] = [];

  constructor(readonly id: string) {}

  checkTurn(tick: number, hash: number): void {
    const seen = this.turnHashes[tick];
    if (seen === undefined) this.turnHashes[tick] = hash;
    else if (seen !== hash) this.changedTurns++;
  }

  /** The measures so far; histograms start again empty. */
  take(): GameData {
    const data: GameData = {
      id: this.id,
      intervals: this.intervals.toData(),
      orderLatency: this.orderLatency.toData(),
      outOfOrder: this.outOfOrder,
      changedTurns: this.changedTurns,
      desyncs: this.desyncs,
      ordersSent: this.ordersSent,
      ordersSeen: this.ordersSeen,
      turnsPerClient: [...this.turnsPerClient],
    };
    this.intervals.reset();
    this.orderLatency.reset();
    return data;
  }
}

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

export interface ClientOptions {
  url: string;
  name: string;
  /**
   * Sent as X-Client-IP so that every simulated player counts as its own
   * address. A reverse proxy in front of the server overwrites it, in which
   * case its per-address connection limit applies to the whole run.
   */
  address: string;
  /** Picks the stats of a game when it starts. */
  statsFor: (game: string) => GameStats;
}

export interface RejoinResult {
  /** From dropping the socket to holding the turn the server had closed last, in ms. */
  caughtUpMs: number;
  /** `rejoin` answered `token_in_use` and sent again. */
  retries: number;
}

/** Set while a client rejoins: when it last received part of the catch-up. */
interface Rejoining {
  started: boolean;
  burstAt: number;
  caughtUp: (at: number) => void;
}

function turnHash(orders: readonly unknown[]): number {
  if (orders.length === 0) return 0;
  const text = JSON.stringify(orders);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

async function open(url: string, address: string): Promise<WebSocket> {
  const socket = new WebSocket(url, { headers: { "x-client-ip": address } });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", reject);
  });
  return socket;
}

/**
 * One simulated player: it speaks protocol v1 like the browser client, sends
 * orders at a human pace and checks every turn it receives.
 */
export class LoadClient {
  private readonly inbox: ServerMessage[] = [];
  private readonly waiters: (() => void)[] = [];
  private sentAt: number[] = [];
  private nextTick = 0;
  /** Ticks below this one were received already: a replay of them is only checked. */
  private seenTicks = 0;
  private lastFrameAt: number | undefined;
  private orderTimer: NodeJS.Timeout | undefined;
  private you = 0;
  private token: string | undefined;
  private stats: GameStats | undefined;
  private closedWith: number | undefined;
  private rejoining: Rejoining | undefined;
  /** Stopped reading its socket: it measures nothing. */
  private slow = false;
  turns = 0;

  private constructor(
    private socket: WebSocket,
    private readonly options: ClientOptions,
  ) {
    this.listen();
  }

  /** Connects and says hello. */
  static async connect(options: ClientOptions): Promise<LoadClient> {
    const client = new LoadClient(await open(options.url, options.address), options);
    await client.hello();
    return client;
  }

  get stalled(): boolean {
    return this.slow;
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(encodeClientMessage(message));
  }

  /** Waits for the next message of this type; messages of other types stay in the inbox. */
  async next<T extends ServerMessage["type"]>(type: T, timeoutMs = 15_000): Promise<Message<T>> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const index = this.inbox.findIndex((message) => message.type === type);
      if (index >= 0) return this.inbox.splice(index, 1)[0] as Message<T>;
      const error = this.inbox.find((message) => message.type === "error");
      if (error) throw new Error(`${this.options.name}: server answered ${error.code}`);
      if (this.closedWith !== undefined) {
        throw new Error(`${this.options.name}: closed with ${String(this.closedWith)}`);
      }
      const left = deadline - performance.now();
      if (left <= 0)
        throw new Error(`${this.options.name}: no ${type} within ${String(timeoutMs)} ms`);
      await this.wait(left);
    }
  }

  /**
   * The next `lobby`, or undefined once the game started: a game set to
   * start when full starts as the last guest joins, without a `lobby` to
   * that guest. `started` stays in the inbox.
   */
  async lobbyOrStarted(timeoutMs = 15_000): Promise<Message<"lobby"> | undefined> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      if (this.stats) return undefined;
      const left = deadline - performance.now();
      const ready = this.inbox.some(
        (message) => message.type === "lobby" || message.type === "error",
      );
      // next() returns the lobby, or throws the error, the close or the timeout.
      if (ready || this.closedWith !== undefined || left <= 0) return this.next("lobby", 0);
      await this.wait(left);
    }
  }

  /**
   * Sends random orders until stopped, one every `intervalMs` on average:
   * first a spawn, then attacks on random tiles of a `mapTiles` map.
   */
  play(intervalMs: number, mapTiles: number): void {
    let spawned = false;
    const schedule = () => {
      this.orderTimer = setTimeout(
        () => {
          const tile = Math.floor(Math.random() * mapTiles);
          const order: Order = spawned
            ? { type: "attack", target: tile, troops: 1 + Math.floor(Math.random() * 5000) }
            : { type: "spawn", tile };
          spawned = true;
          this.order(order);
          schedule();
        },
        intervalMs * (0.5 + Math.random()),
      );
    };
    schedule();
  }

  /**
   * Stops reading the socket and sending anything, like a frozen tab: what
   * the server sends piles up in its buffers.
   */
  stall(): void {
    this.slow = true;
    clearTimeout(this.orderTimer);
    (this.socket as unknown as { _socket: Socket })._socket.pause();
  }

  /**
   * Drops the socket without a close frame, as a lost network does, then
   * connects again and rejoins from the first tick not received, or from 0
   * as a reloaded page without a snapshot does.
   */
  async rejoin(fromZero: boolean, timeoutMs = 60_000): Promise<RejoinResult> {
    const token = this.token;
    if (!token) throw new Error(`${this.options.name}: no token to rejoin with`);
    const caughtUp = new Promise<number>((resolve) => {
      this.rejoining = { started: false, burstAt: 0, caughtUp: resolve };
    });
    const droppedAt = performance.now();
    this.drop();
    this.socket = await open(this.options.url, this.options.address);
    this.listen();
    await this.hello();
    const from = fromZero ? 0 : this.nextTick;
    // The catch-up must start at `from`; anything else counts as out of order.
    this.nextTick = from;
    let retries = 0;
    for (;;) {
      this.send({ type: "rejoin", token, from });
      try {
        await this.next("started", timeoutMs);
        break;
      } catch (error) {
        const busy = this.inbox.findIndex(
          (message) => message.type === "error" && message.code === "token_in_use",
        );
        if (busy < 0 || retries >= REJOIN_ATTEMPTS) throw error;
        this.inbox.splice(busy, 1);
        retries++;
        await new Promise((resolve) => setTimeout(resolve, REJOIN_RETRY_MS));
      }
    }
    let timer: NodeJS.Timeout | undefined;
    const at = await Promise.race([
      caughtUp,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${this.options.name}: not caught up within ${String(timeoutMs)} ms`));
        }, timeoutMs);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
    return { caughtUpMs: at - droppedAt, retries };
  }

  /** Stops sending orders and leaves the game, so the server can close it at once. */
  stop(): void {
    clearTimeout(this.orderTimer);
    if (this.slow) {
      // A close handshake would wait for a reply the socket no longer reads.
      this.socket.terminate();
      return;
    }
    this.stats?.turnsPerClient.push(this.turns);
    this.send({ type: "leave" });
    this.socket.close();
  }

  private async hello(): Promise<void> {
    this.send({ type: "hello", version: PROTOCOL_VERSION, name: this.options.name });
    await this.next("welcome");
  }

  private listen(): void {
    this.closedWith = undefined;
    this.socket.on("message", (data: Buffer, isBinary: boolean) => {
      this.receive(isBinary ? new Uint8Array(data) : data.toString("utf8"));
    });
    // A reset connection emits an error, then closes.
    this.socket.on("error", () => undefined);
    this.socket.on("close", (code: number) => {
      this.closedWith = code;
      this.wake();
    });
  }

  private drop(): void {
    const socket = this.socket;
    socket.removeAllListeners("message");
    socket.removeAllListeners("close");
    socket.terminate();
    this.inbox.length = 0;
    // Orders in flight may be lost with the socket.
    this.sentAt = [];
    this.lastFrameAt = undefined;
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private order(order: Order): void {
    if (!this.stats || this.rejoining || this.socket.readyState !== WebSocket.OPEN) return;
    this.sentAt.push(performance.now());
    this.stats.ordersSent++;
    this.send({ type: "order", order });
  }

  private receive(frame: string | Uint8Array): void {
    if (this.slow) return;
    const parsed = parseServerMessage(frame);
    if (!parsed.ok) throw new Error(`${this.options.name}: invalid frame: ${parsed.error}`);
    const message = parsed.value;
    if (message.type === "turns") {
      this.receiveTurns(message);
      return;
    }
    if (message.type === "started") {
      // Set before the first turn, which can arrive in the same read.
      this.you = message.you;
      this.token = message.token;
      this.stats = this.options.statsFor(message.game);
      if (this.rejoining) {
        this.rejoining.started = true;
        this.rejoining.burstAt = performance.now();
      }
    }
    if (message.type === "desync" && this.stats) this.stats.desyncs++;
    this.inbox.push(message);
    this.wake();
  }

  private receiveTurns(message: Message<"turns">): void {
    const stats = this.stats;
    if (!stats) throw new Error(`${this.options.name}: turns before the game started`);
    const now = performance.now();
    const rejoining = this.rejoining;
    const first = message.turns[0]?.tick;
    if (rejoining?.started) {
      // The server sends the catch-up at once after `started`, in frames of
      // up to 2,000 turns, then live turns one per frame. The client holds
      // the current turn once the last frame of that burst is in.
      if (message.turns.length > 1) rejoining.burstAt = now;
      else {
        this.rejoining = undefined;
        this.lastFrameAt = now;
        rejoining.caughtUp(rejoining.burstAt);
      }
    } else if (!rejoining) {
      if (this.lastFrameAt !== undefined) stats.intervals.record(now - this.lastFrameAt);
      this.lastFrameAt = now;
    }
    if (first !== this.nextTick) stats.outOfOrder++;
    for (const turn of message.turns) {
      this.nextTick = turn.tick + 1;
      stats.checkTurn(turn.tick, turnHash(turn.orders));
      if (turn.tick < this.seenTicks) continue;
      this.seenTicks = turn.tick + 1;
      this.turns = this.seenTicks;
      for (const { player } of turn.orders) {
        if (player !== this.you) continue;
        const sentAt = this.sentAt.shift();
        if (sentAt !== undefined) stats.orderLatency.record(now - sentAt);
        stats.ordersSeen++;
      }
      if (turn.tick > 0 && turn.tick % HASH_EVERY === 0) {
        // Every client reports the same hash, so a desync would be the server's doing.
        this.send({ type: "hash", tick: turn.tick, hash: Math.imul(turn.tick, 0x9e3779b1) >>> 0 });
      }
    }
  }

  private wake(): void {
    for (const wake of this.waiters.splice(0)) wake();
  }
}
