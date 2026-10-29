import {
  ClientMessage,
  CloseCode,
  encodeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ErrorCode,
  type GameOptions,
  type ReportReason,
  type Order,
  type ServerMessage,
  type Turn,
  type Visibility,
} from "@frontfall/protocol";

const MAX_RETRY_DELAY_MS = 10_000;
const FULL_RETRY_DELAY_MS = 15_000;
const MAX_FULL_RETRY_DELAY_MS = 60_000;

/** WebSocket URL next to the page, so the game works under any path prefix. */
export function socketUrl(page: string): string {
  const url = new URL("ws", page);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.hash = "";
  url.search = "";
  return url.href;
}

/** Spreads a delay over [0.5, 1.5) times itself, so pages do not come back in waves. */
function jitter(base: number, random: () => number): number {
  return Math.round(base * (0.5 + random()));
}

/** Delay before reconnecting after a network fault: exponential, then jittered. */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  return jitter(Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt), random);
}

/** Delay before trying again when the server is full: 15 s, doubling up to 60 s, jittered. */
export function fullDelay(attempt: number, random: () => number = Math.random): number {
  return jitter(Math.min(MAX_FULL_RETRY_DELAY_MS, FULL_RETRY_DELAY_MS * 2 ** attempt), random);
}

export type LobbyState = Extract<ServerMessage, { type: "lobby" }>;
export type GameStart = Extract<ServerMessage, { type: "started" }>;

export type ConnectionStatus =
  /** Opening the socket or saying hello. */
  | "connecting"
  /** Ready to play or playing. */
  | "online"
  /** The connection dropped; a new attempt starts after `retryInMs`. */
  | "offline"
  /** The server holds all the connections it serves well; a new attempt starts after `retryInMs`. */
  | "full"
  /** The server speaks another protocol version: the page must be reloaded. */
  | "outdated"
  /**
   * The server closed the connection over a message it refused or too many
   * messages: trying again would end the same way.
   */
  | "rejected"
  /** The operator of the server banned this network (R-MODE-06): trying again would be refused. */
  | "banned";

export interface OnlineEvents {
  status?(status: ConnectionStatus, retryInMs?: number): void;
  /**
   * `behind` when the lobby predates a `configure` still on its way: a form
   * would show settings the host already changed.
   */
  lobby?(lobby: LobbyState, behind: boolean): void;
  /** The game starts, or starts again after a rejoin: reset the simulation, then expect turns. */
  started?(game: GameStart): void;
  /** Consecutive turns, never skipping one, from the tick after the last one delivered. */
  turns?(turns: Turn[]): void;
  /** This game's hash for `tick`, and the other players' when most of them agreed. */
  desync?(tick: number, hash: number, expected: number | null): void;
  /** `seatLost`: the seat of this page is gone, after a long absence or once the server lost the game. */
  ended?(reason: Extract<ServerMessage, { type: "ended" }>["reason"] | "seatLost"): void;
  error?(code: ErrorCode, message: string): void;
  /** The server restarts for an update in `inMs` milliseconds, or no longer does (`null`). */
  maintenance?(inMs: number | null): void;
}

/** The subset of the browser WebSocket this module needs, so tests can supply their own. */
export interface SocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void): void;
}

export interface OnlineOptions {
  url: string;
  name: string;
  /** Build of the page, so the server can turn away an outdated one. */
  build?: string;
  events: OnlineEvents;
  createSocket?: (url: string) => SocketLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  /** Source of the reconnect jitter, in [0, 1). */
  random?: () => number;
}

/**
 * How a player enters an online game: the next public one (opening one under
 * `name` if none waits), a new game of their own, one by id, or back into a
 * running game with the seat's token after the page reloaded.
 */
export type OnlineEntry =
  | { type: "play"; name?: string }
  | { type: "join"; game: string }
  | { type: "create"; visibility?: Visibility; name?: string }
  | { type: "resume"; game: string; token: string };
type Entry =
  Exclude<OnlineEntry, { type: "resume" }> | { type: "resume"; token: string; from: number };

/**
 * One player's link to the game server. It keeps the connection open,
 * reconnecting with backoff, and takes back the player's seat after a drop:
 * the server then resends every turn the client missed.
 */
export class OnlineClient {
  private socket: SocketLike | undefined;
  private attempt = 0;
  private closedByUser = false;
  /** What the player asked for, replayed if the connection drops before the game starts. */
  private entry: Entry | undefined;
  private game: GameStart | undefined;
  /** The seat held in a lobby: after a drop, the server keeps it for a while. */
  private lobbySeat: { game: string; token: string } | undefined;
  /** `configure` messages sent from the seat, numbered for the server to echo. */
  private configures = { token: "", sent: 0 };
  private nextTick = 0;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;

  constructor(private readonly options: OnlineOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.open();
  }

  /** Join the fullest public game waiting, or open one under `name`. */
  play(name?: string): void {
    this.enter({ type: "play", ...(name !== undefined && { name }) });
  }

  /** Open a game of one's own; a public one is listed under `name`, any is joined by `?game=<id>`. */
  create(visibility: Visibility = "private", name?: string): void {
    this.enter({ type: "create", visibility, ...(name !== undefined && { name }) });
  }

  /** Joins a game by id; an id the protocol cannot carry is refused here, as not found. */
  join(game: string): void {
    if (!ClientMessage.safeParse({ type: "join", game }).success) {
      this.options.events.error?.("not_found", "no game has this id");
      return;
    }
    this.enter({ type: "join", game });
  }

  /**
   * Takes back a seat in a running game, every turn from `from` resent: 0,
   * or the tick of a snapshot the page starts the game from (#39).
   */
  resume(token: string, from = 0): void {
    this.enter({ type: "resume", token, from });
  }

  /**
   * The page could not start from the snapshot it resumed with: asks again
   * for every turn from the first one, over a new connection.
   */
  replayFromStart(): void {
    if (!this.game) return;
    this.nextTick = 0;
    this.socket?.close(1000);
  }

  /** Host: map, bots, seats and, for a public game, its name, until the start. */
  configure(options: GameOptions, name?: string): void {
    const token = this.lobbySeat?.token ?? "";
    if (this.configures.token !== token) this.configures = { token, sent: 0 };
    this.configures.sent += 1;
    this.send({
      type: "configure",
      options,
      ...(name !== undefined && { name }),
      seq: this.configures.sent,
    });
  }

  /** Host: start now. */
  start(): void {
    this.send({ type: "start" });
  }

  /** Host, once: stop the countdown of a quick game. */
  hold(): void {
    this.send({ type: "hold" });
  }

  /** Host: removes the player with this lobby number, who cannot come back (R-MODE-05). */
  kick(player: number): void {
    this.send({ type: "kick", player });
  }

  /** Reports another player of the game to the server's operator (R-MODE-06). */
  report(player: number, reason: ReportReason): void {
    this.send({ type: "report", player, reason });
  }

  /** The player is at the screen, so the host keeps the role. */
  active(): void {
    this.send({ type: "active" });
  }

  leave(): void {
    this.entry = undefined;
    this.game = undefined;
    this.lobbySeat = undefined;
    this.send({ type: "leave" });
  }

  order(order: Order): void {
    this.send({ type: "order", order });
  }

  /** Hash of the local game state after running `tick`, for desync detection. */
  hash(tick: number, hash: number): void {
    this.send({ type: "hash", tick, hash });
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close(1000);
  }

  private enter(entry: Entry): void {
    this.entry = entry;
    this.game = undefined;
    this.lobbySeat = undefined;
    this.sendEntry(entry);
  }

  private sendEntry(entry: Entry): void {
    if (entry.type === "resume")
      this.send({ type: "rejoin", token: entry.token, from: entry.from });
    else this.send(entry);
  }

  /** The token of the seat being taken back, in a game or after a reload. */
  private get token(): string | undefined {
    return (
      this.game?.token ??
      this.lobbySeat?.token ??
      (this.entry?.type === "resume" ? this.entry.token : undefined)
    );
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(encodeClientMessage(message));
  }

  private open(): void {
    this.options.events.status?.("connecting");
    const socket = this.createSocket(this.options.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(
        encodeClientMessage({
          type: "hello",
          version: PROTOCOL_VERSION,
          name: this.options.name,
          ...(this.options.build !== undefined && { build: this.options.build }),
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
      if (typeof data !== "string" && !(data instanceof Uint8Array)) return;
      const parsed = parseServerMessage(data);
      if (parsed.ok) this.receive(parsed.value);
      // Turns this page cannot read come from a newer server: going on would skip
      // them and desynchronise, so stop and ask for a reload.
      else if (data instanceof Uint8Array) this.outdated(socket);
    });
    socket.addEventListener("close", ({ code }) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (code === CloseCode.versionMismatch) {
        this.outdated(socket);
        return;
      }
      if (this.closedByUser) return;
      if (code === CloseCode.invalidMessage || code === CloseCode.rateLimited) {
        this.closedByUser = true;
        this.options.events.status?.("rejected");
        return;
      }
      if (code === CloseCode.banned) {
        this.closedByUser = true;
        this.options.events.status?.("banned");
        return;
      }
      const random = this.options.random ?? Math.random;
      const full = code === CloseCode.full;
      const delay = full ? fullDelay(this.attempt++, random) : retryDelay(this.attempt++, random);
      this.options.events.status?.(full ? "full" : "offline", delay);
      this.setTimer(() => {
        // Closed by the page during the wait: no new connection.
        if (!this.closedByUser) this.open();
      }, delay);
    });
  }

  private outdated(socket: SocketLike): void {
    this.closedByUser = true;
    this.socket = undefined;
    socket.close(1000);
    this.options.events.status?.("outdated");
  }

  private receive(message: ServerMessage): void {
    const { events } = this.options;
    switch (message.type) {
      case "welcome":
        this.attempt = 0;
        // Whatever went out on the old connection is answered or lost; the
        // server numbers this connection's anew too, from its rejoin on.
        this.configures.sent = 0;
        events.status?.("online");
        if (this.game) {
          this.send({ type: "rejoin", token: this.game.token, from: this.nextTick });
        } else if (this.lobbySeat) {
          // Back to the lobby, or into the game if it started meanwhile.
          this.send({ type: "rejoin", token: this.lobbySeat.token, from: 0 });
        } else if (this.entry) {
          this.sendEntry(this.entry);
        }
        return;
      case "lobby":
        this.lobbySeat = { game: message.game, token: message.token };
        // Should the seat be lost, joining this game again beats opening another one.
        if (this.entry?.type === "create") this.entry = { type: "join", game: message.game };
        events.lobby?.(
          message,
          this.configures.token === message.token && message.configured < this.configures.sent,
        );
        return;
      case "started": {
        // A rejoin resends the start: the simulation keeps its state and only gets the missing turns.
        const rejoined = this.game?.game === message.game;
        this.game = message;
        this.lobbySeat = undefined;
        if (!rejoined) {
          // A resumed game starts where its snapshot left it.
          this.nextTick = this.entry?.type === "resume" ? this.entry.from : 0;
          events.started?.(message);
        }
        return;
      }
      case "turns": {
        const fresh = message.turns.filter((turn) => turn.tick >= this.nextTick);
        if (fresh.length === 0) return;
        if ((fresh[0]?.tick ?? 0) > this.nextTick) {
          // A turn went missing: reconnect and ask for every turn from the gap on.
          this.socket?.close(1000);
          return;
        }
        this.nextTick = (fresh.at(-1)?.tick ?? this.nextTick) + 1;
        events.turns?.(fresh);
        return;
      }
      case "desync":
        events.desync?.(message.tick, message.hash, message.expected);
        return;
      case "maintenance":
        events.maintenance?.(message.inMs);
        return;
      // The menu marks a report as sent at once; only a refusal changes that.
      case "reported":
        return;
      case "ended":
        this.entry = undefined;
        this.game = undefined;
        this.lobbySeat = undefined;
        events.ended?.(message.reason);
        return;
      case "error":
        if (message.code === "token_invalid" && this.lobbySeat && !this.game) {
          // The lobby gave the seat away: join again with the same request.
          this.lobbySeat = undefined;
          if (this.entry && this.entry.type !== "resume") {
            this.sendEntry(this.entry);
            return;
          }
        }
        if (message.code === "token_invalid" && this.game) {
          // The seat is gone: the game went on without this player, or the server lost it.
          this.game = undefined;
          this.entry = undefined;
          events.ended?.("seatLost");
          return;
        }
        if (message.code === "token_in_use" && this.token) {
          // The server is checking the previous connection; ask again shortly.
          const token = this.token;
          this.setTimer(() => {
            if (this.token === token) {
              const from = this.entry?.type === "resume" ? this.entry.from : 0;
              this.send({ type: "rejoin", token, from: this.game ? this.nextTick : from });
            }
          }, 1_000);
          return;
        }
        if (message.code === "token_invalid") this.entry = undefined;
        events.error?.(message.code, message.message);
        return;
    }
  }
}
