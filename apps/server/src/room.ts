import {
  encodeServerMessage,
  encodeTurnsFrame,
  HASH_INTERVAL,
  MAX_NAME_LENGTH,
  TICK_RATE,
  type Difficulty,
  type ErrorCode,
  type GameSpeed,
  type Frame,
  type GameOptions,
  type GameRules,
  type Order,
  type PlayerInfo,
  type ServerMessage,
  type Teams,
  type Turn,
} from "@frontfall/protocol";
import { newToken } from "./ids.ts";
import { TurnLog } from "./turn-log.ts";

/** The connection of one player, as the room sees it. */
export interface Peer {
  send(frame: Frame): void;
  /**
   * Sends the frames of a catch-up, then `last` if any. A connection may pace
   * them by what the client reads; the frames must then run on to the end of
   * the log, and live turns it would get meanwhile are covered by them.
   */
  replay?(frames: Iterable<Frame>, last?: Frame): void;
  /** Asks the connection to prove it is alive, and drops it if it does not answer. */
  probe(): void;
}

export interface RoomSettings {
  visibility: "public" | "private";
  /** Name of a public game in the list; null for a private one. */
  name: string | null;
  map: string;
  capacity: number;
  /** Start as soon as every seat is taken. */
  autoStart: boolean;
  /** Bots added by every client at the start; the server never sees their orders. */
  bots: number;
  difficulty: Difficulty;
  /** Whether every client adds the map's nations after the bots. */
  nations: boolean;
  /** Teams every client deals the players into (R-MODE-02); 0 for a free-for-all. */
  teams: Teams;
  /** What every client leaves out of the game (R-MODE-03). */
  disabled: number;
  /** Turns closed at each tick of the server (R-MODE-07); 1 in a public game. */
  speed: GameSpeed;
  /** Special rules every client plays with (R-MODE-08); the defaults in a public game. */
  rules: GameRules;
  /** Players needed before the host can start, and before the countdown runs. */
  minPlayers: number;
  /** Wait after reaching minPlayers before starting on its own; 0 waits for the host. */
  countdownMs: number;
  /** A host who has not been at the screen for this long hands the role on. */
  hostIdleMs: number;
  /**
   * Quick games: bots that fill in for opponents when a player is still alone
   * at the end of the countdown, which then starts with the first player. 0
   * waits for minPlayers.
   */
  soloBots: number;
  /** How long a seat stays reserved for a player whose connection dropped. */
  reconnectGraceMs: number;
  /** The same before the start: a phone that sleeps a moment keeps its place, and the host its role. */
  lobbyGraceMs: number;
  /** A game still running after this long is stopped. */
  maxDurationMs: number;
  /** A game that has not started this long after it opened is closed. */
  lobbyTimeoutMs: number;
  /** Orders one player may add to one turn; more are dropped. */
  maxOrdersPerTurn: number;
  /** Seats players from one address may take in a public game (R-MODE-05); 0 for no limit. */
  seatsPerAddress: number;
  /** A game whose turn log grows past this many bytes is stopped. */
  maxLogBytes: number;
}

export type RoomState = "open" | "starting" | "running" | "finished";

export type FinishReason = "abandoned" | "timeout" | "expired" | "empty" | "restart";

export interface Seat {
  /** Number shown in the lobby, replaced by the final player number at start. */
  id: number;
  readonly name: string;
  readonly token: string;
  /** Address of the player who took the seat, for per-address limits; unknown after a restart. */
  readonly address?: string | undefined;
  peer: Peer | undefined;
  /** When the connection dropped, while the seat waits for the player to come back. */
  awaySince: number | undefined;
  /** Left for good: the seat cannot be taken back. */
  gone: boolean;
  /** Orders added to the turn being filled. */
  orders: number;
  /** Last message from the player, to tell a host who walked away. */
  activeAt: number;
  /** Last `configure` handled for this player, applied or refused, echoed in `lobby`. */
  configured: number;
}

/** A running game as a restart keeps it (saved-games.ts). */
export interface SavedRoom {
  id: string;
  seed: number;
  owner: string | undefined;
  settings: RoomSettings;
  /** Time since the start, so that the time limit goes on where it was. */
  elapsedMs: number;
  seats: { id: number; name: string; token: string; gone: boolean }[];
  log: { bodies: Uint8Array; ends: Uint32Array };
}

/** Receives what happens in a room, for logs and metrics. */
export interface RoomObserver {
  started?(room: Room): void;
  finished?(room: Room, reason: FinishReason): void;
  /** `hash` is the flagged players' hash, `expected` the majority's, if any. */
  desync?(room: Room, tick: number, hash: number, expected: number | undefined): void;
}

/**
 * Ticks during which hashes for one tick are collected. Clients that are
 * behind report late; whoever has not reported by then is left out. At speed
 * 1: a faster game waits as long, for more ticks.
 */
const HASH_WINDOW_TICKS = 600;

/**
 * One game, from the first player in its lobby to its end. The room never
 * simulates the game: it numbers turns, keeps their log and relays them, so
 * that every client replays the same orders in the same order.
 */
export class Room {
  private stateValue: RoomState = "open";
  private readonly seats: Seat[] = [];
  private nextLobbyId = 1;
  private host: Seat | undefined;
  private startsAt: number | undefined;
  /** The host stopped the countdown; the game now waits for them. */
  private held = false;
  private openedAt: number | undefined;
  private startedAt = 0;
  private pending: Turn["orders"] = [];
  /** Hashes reported for each checked tick, by seat. */
  private readonly hashes = new Map<number, Map<Seat, number>>();
  /** Seats found out of step, with the first tick they disagreed on. */
  private readonly desyncs = new Map<Seat, Frame>();
  /** Addresses of the players the host removed: they cannot join this game again. */
  private readonly removed = new Set<string>();
  readonly log = new TurnLog();

  constructor(
    readonly id: string,
    settings: RoomSettings,
    readonly seed: number,
    private readonly observer: RoomObserver = {},
    /** Address of the player who opened the game, for per-address limits. */
    readonly owner?: string,
  ) {
    // Copied: the host changes the map, the bots and the name of their own game.
    this.settings = { ...settings };
  }

  readonly settings: RoomSettings;

  get state(): RoomState {
    return this.stateValue;
  }

  get playerCount(): number {
    return this.seats.filter((seat) => !seat.gone).length;
  }

  get connectedCount(): number {
    return this.seats.filter((seat) => seat.peer).length;
  }

  get desynced(): boolean {
    return this.desyncs.size > 0;
  }

  /** True while the seat belongs to this room and can act in it. */
  holds(seat: Seat): boolean {
    return this.stateValue !== "finished" && !seat.gone && this.seats.includes(seat);
  }

  seatFor(token: string): Seat | undefined {
    return this.seats.find((seat) => seat.token === token && !seat.gone);
  }

  /** Milliseconds before the countdown ends, or null when none runs. */
  startsIn(now: number): number | null {
    return this.startsAt === undefined ? null : Math.max(0, Math.ceil(this.startsAt - now));
  }

  join(name: string, peer: Peer, now: number, address?: string): Seat | ErrorCode {
    if (this.stateValue === "running" || this.stateValue === "finished") return "game_started";
    if (address !== undefined && this.removed.has(address)) return "removed";
    if (this.seats.length >= this.settings.capacity) return "game_full";
    if (address !== undefined && this.atSeatLimit(address)) return "too_many_seats";
    const seat: Seat = {
      id: this.nextLobbyId++,
      name: this.freeName(name),
      token: newToken(),
      address,
      peer,
      awaySince: undefined,
      gone: false,
      orders: 0,
      activeAt: now,
      configured: 0,
    };
    this.seats.push(seat);
    this.openedAt ??= now;
    // A countdown nearly over when an opponent arrives leaves a third a chance.
    if (this.startsAt !== undefined && this.seats.length === this.settings.minPlayers) {
      this.startsAt = Math.max(this.startsAt, now + this.settings.countdownMs / 2);
    }
    this.host ??= seat;
    this.lobbyChanged(now);
    return seat;
  }

  /**
   * Whether players from `address` hold every seat one address may take.
   * Only public games count: a private game is shared by invitation, often
   * with people on the same network.
   */
  atSeatLimit(address: string): boolean {
    const limit = this.settings.seatsPerAddress;
    if (this.settings.visibility !== "public" || limit <= 0) return false;
    return this.seats.filter((seat) => seat.address === address).length >= limit;
  }

  /** Whether the host removed a player from this address (R-MODE-05). */
  bars(address: string): boolean {
    return this.removed.has(address);
  }

  /**
   * `name`, or `name 2`, `name 3`... when a player in the game already goes
   * by it: every player who kept the default name would look alike.
   */
  private freeName(name: string): string {
    const taken = new Set(this.seats.map((seat) => seat.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${String(n)}`;
      const base = Array.from(name)
        .slice(0, MAX_NAME_LENGTH - suffix.length)
        .join("")
        .trimEnd();
      const candidate = base + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  get hostName(): string {
    return this.host?.name ?? "";
  }

  /** The player sent something: they are at the screen. */
  touch(seat: Seat, now: number): void {
    seat.activeAt = now;
  }

  /** The player leaves for good. Before the start, their seat is freed. */
  leave(seat: Seat, now: number): void {
    if (!this.holds(seat)) return;
    if (this.stateValue === "running") {
      seat.gone = true;
      seat.peer = undefined;
      return;
    }
    this.seats.splice(this.seats.indexOf(seat), 1);
    seat.gone = true;
    seat.peer = undefined;
    if (this.host === seat) this.host = this.nextHost();
    if (this.seats.length === 0) {
      this.finish("empty");
      return;
    }
    this.lobbyChanged(now);
  }

  /**
   * The connection dropped: the seat waits for the player to rejoin. Before
   * the start, a connection the page closed itself, as on a reload or when
   * the tab closes, gives the seat up at once.
   */
  disconnect(seat: Seat, now: number, closedByPage = false): void {
    if (!this.holds(seat)) return;
    if (this.stateValue !== "running" && (closedByPage || this.settings.lobbyGraceMs <= 0)) {
      this.leave(seat, now);
      return;
    }
    seat.peer = undefined;
    seat.awaySince = now;
  }

  /**
   * Gives the seat to a new connection. Before the start, the player is back
   * in the lobby; in a running game, they receive every turn from `from` on.
   */
  rejoin(seat: Seat, peer: Peer, from: number, now: number): ErrorCode | undefined {
    if (!this.holds(seat)) return "token_invalid";
    if (seat.peer) {
      seat.peer.probe();
      return "token_in_use";
    }
    seat.peer = peer;
    seat.awaySince = undefined;
    seat.activeAt = now;
    // A new connection numbers its `configure` messages from 1 again.
    seat.configured = 0;
    if (this.stateValue !== "running") {
      this.lobbyChanged(now);
      return undefined;
    }
    peer.send(this.startedMessage(seat));
    // Replaying from the first turn rebuilds the game from scratch: the hashes
    // it reports next decide afresh. Otherwise the client keeps its old state.
    if (from === 0) this.desyncs.delete(seat);
    const desync = this.desyncs.get(seat);
    const frames = this.log.frames(Math.min(from, this.log.length));
    if (peer.replay) {
      peer.replay(frames, desync);
      return undefined;
    }
    for (const frame of frames) peer.send(frame);
    if (desync !== undefined) peer.send(desync);
    return undefined;
  }

  /** The seat of player number `player`, gone or not, if this game has one. */
  seatOf(player: number): Seat | undefined {
    return this.seats.find((seat) => seat.id === player);
  }

  /**
   * Host, before the start: removes another player, who is told and cannot
   * join this game again from the same address (R-MODE-05).
   */
  kick(seat: Seat, player: number, now: number): ErrorCode | undefined {
    const refused = this.hostOnly(seat);
    if (refused) return refused;
    const target = this.seats.find((other) => other.id === player);
    if (!target || target === seat) return "not_found";
    if (target.address !== undefined) this.removed.add(target.address);
    target.peer?.send(encodeServerMessage({ type: "ended", reason: "removed" }));
    target.awaySince = undefined;
    this.leave(target, now);
    return undefined;
  }

  /** Host: map, bots, difficulty, seats and, for a public game, its name, until the start. */
  configure(
    seat: Seat,
    options: GameOptions & { name?: string; soloBots?: number },
    now: number,
    seq?: number,
  ): ErrorCode | undefined {
    const refused = this.hostOnly(seat);
    if (refused) return refused;
    if (seq !== undefined) seat.configured = seq;
    const { name, ...rest } = options;
    Object.assign(this.settings, rest);
    if (name !== undefined && this.settings.visibility === "public") this.settings.name = name;
    this.lobbyChanged(now);
    return undefined;
  }

  /**
   * A `configure` was refused: the lobby goes back to the player alone, so
   * that a form filled ahead of the server's answers shows the settings
   * that hold again.
   */
  refusedConfigure(seat: Seat, seq: number, now: number): void {
    if (!this.holds(seat) || this.stateValue === "running") return;
    seat.configured = seq;
    seat.peer?.send(this.lobbyMessage(seat, this.players(), this.startsIn(now)));
  }

  /** Host: start now, with at least the game's minimum of players. */
  requestStart(seat: Seat, now: number): ErrorCode | undefined {
    const refused = this.hostOnly(seat);
    if (refused) return refused;
    if (this.seats.length < this.settings.minPlayers) return "not_enough_players";
    this.start(now);
    return undefined;
  }

  /** The host stopped the countdown: the game waits for them to start it. */
  get isHeld(): boolean {
    return this.held;
  }

  /** Host, once: stop the countdown. The game then waits for the host to start it. */
  hold(seat: Seat, now: number): ErrorCode | undefined {
    const refused = this.hostOnly(seat);
    if (refused) return refused;
    if (this.startsAt === undefined || this.held) return undefined;
    this.held = true;
    this.lobbyChanged(now);
    return undefined;
  }

  private hostOnly(seat: Seat): ErrorCode | undefined {
    if (!this.holds(seat)) return "not_in_game";
    if (this.stateValue === "running") return "game_started";
    if (this.host !== seat) return "not_host";
    return undefined;
  }

  submit(seat: Seat, order: Order): boolean {
    if (this.stateValue !== "running" || !this.holds(seat) || !seat.peer) return false;
    if (seat.orders >= this.settings.maxOrdersPerTurn) return false;
    seat.orders++;
    this.pending.push({ player: seat.id, order });
    return true;
  }

  /**
   * Records the hash of a client's state after `tick`. Once every connected
   * player has reported, or the window has passed, the hashes are compared.
   */
  reportHash(seat: Seat, tick: number, hash: number): void {
    if (this.stateValue !== "running" || !this.holds(seat) || tick % HASH_INTERVAL !== 0) return;
    if (tick >= this.log.length || tick < this.log.length - this.hashWindow) return;
    let reports = this.hashes.get(tick);
    if (!reports) {
      reports = new Map();
      this.hashes.set(tick, reports);
    }
    if (reports.has(seat)) return;
    reports.set(seat, hash);
    if (this.seats.every((other) => !other.peer || reports.has(other))) this.compare(tick);
  }

  /**
   * Flags the players whose hash differs from the majority's. A client
   * cannot mark others out of step by lying: it only singles itself out,
   * unless no majority exists, as with two players who disagree.
   */
  private compare(tick: number): void {
    const reports = this.hashes.get(tick);
    this.hashes.delete(tick);
    if (!reports) return;
    const votes = new Map<number, number>();
    for (const hash of reports.values()) votes.set(hash, (votes.get(hash) ?? 0) + 1);
    if (votes.size < 2) return;
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [first, second] = ranked;
    const majority = first && second && first[1] > second[1] ? first[0] : undefined;
    const firstDesync = this.desyncs.size === 0;
    let flagged: number | undefined;
    for (const [seat, hash] of reports) {
      if (hash === majority || this.desyncs.has(seat)) continue;
      const message = encodeServerMessage({
        type: "desync",
        tick,
        hash,
        expected: majority ?? null,
      });
      this.desyncs.set(seat, message);
      seat.peer?.send(message);
      flagged ??= hash;
    }
    if (firstDesync && flagged !== undefined) this.observer.desync?.(this, tick, flagged, majority);
  }

  /** Runs once per tick of the server: countdown, turn, timeouts. */
  update(now: number): void {
    switch (this.stateValue) {
      case "open":
      case "starting":
        this.expireLobbySeats(now);
        if (this.state === "finished") return;
        if (this.startsAt !== undefined && now >= this.startsAt) this.start(now);
        else if (this.hostWalkedAway(now)) this.passHost(now);
        else if (
          this.openedAt !== undefined &&
          now - this.openedAt >= this.settings.lobbyTimeoutMs
        ) {
          this.finish("expired");
        }
        return;
      case "running":
        this.closeTurns(this.settings.speed);
        this.compareLateHashes();
        this.expireSeats(now);
        return;
      case "finished":
        return;
    }
  }

  /** Stops the game at once, for example when the server shuts down. */
  stop(reason: FinishReason = "abandoned"): void {
    if (this.stateValue !== "finished") this.finish(reason);
  }

  /**
   * The host has sent nothing for a while and others wait: they would be
   * stuck until the lobby expires. A host alone keeps the role.
   */
  private hostWalkedAway(now: number): boolean {
    const { host } = this;
    return (
      host !== undefined &&
      this.seats.length >= 2 &&
      // A dropped host keeps the role while their seat waits for them.
      host.awaySince === undefined &&
      now - host.activeAt >= this.settings.hostIdleMs
    );
  }

  /**
   * Who takes the role from the host: a player still connected, the one at
   * the screen most recently; anyone left when nobody else is connected.
   */
  private nextHost(): Seat | undefined {
    const others = this.seats.filter((seat) => seat !== this.host);
    const connected = others.filter((seat) => seat.peer && seat.awaySince === undefined);
    const pool = connected.length > 0 ? connected : others;
    return pool.reduce<Seat | undefined>(
      (best, seat) => (!best || seat.activeAt > best.activeAt ? seat : best),
      undefined,
    );
  }

  /** The host walked away: the role goes on, unless nobody else is connected. */
  private passHost(now: number): void {
    const next = this.nextHost();
    if (!next?.peer) return;
    this.host = next;
    next.activeAt = now;
    this.lobbyChanged(now);
  }

  /**
   * The running game, for the next server to take over; undefined in any
   * other state. Nothing the clients compute is in it, only their turns,
   * the orders not yet in a turn included.
   */
  save(now: number): SavedRoom | undefined {
    if (this.stateValue !== "running") return undefined;
    // Orders sent since the last turn would be lost: they make one more turn.
    if (this.pending.length > 0) this.closeTurns(1);
    return {
      id: this.id,
      seed: this.seed,
      owner: this.owner,
      settings: { ...this.settings },
      elapsedMs: Math.max(0, now - this.startedAt),
      seats: this.seats.map(({ id, name, token, gone }) => ({ id, name, token, gone })),
      log: this.log.export(),
    };
  }

  /**
   * Ends the game on this server without a word to its players, once it is
   * saved: they reconnect, and the next server gives them their seats back.
   */
  suspend(): void {
    this.stateValue = "finished";
    for (const seat of this.seats) seat.peer = undefined;
    this.pending = [];
  }

  /**
   * A saved game, running again from its last turn. Every seat waits for its
   * player as after a dropped connection. Undefined when the log is broken.
   */
  static restore(saved: SavedRoom, observer: RoomObserver, now: number): Room | undefined {
    const room = new Room(saved.id, saved.settings, saved.seed, observer, saved.owner);
    if (!room.log.load(saved.log.bodies, saved.log.ends)) return undefined;
    room.stateValue = "running";
    room.startedAt = now - saved.elapsedMs;
    for (const { id, name, token, gone } of saved.seats) {
      room.seats.push({
        id,
        name,
        token,
        peer: undefined,
        awaySince: gone ? undefined : now,
        gone,
        orders: 0,
        activeAt: now,
        configured: 0,
      });
    }
    return room;
  }

  private start(now: number): void {
    // Only a countdown starts a game short of players: bots stand in for them.
    if (this.seats.length < this.settings.minPlayers) {
      this.settings.bots = Math.max(this.settings.bots, this.settings.soloBots);
    }
    this.stateValue = "running";
    this.startsAt = undefined;
    this.startedAt = now;
    this.seats.forEach((seat, index) => {
      seat.id = index + 1;
    });
    for (const seat of this.seats) seat.peer?.send(this.startedMessage(seat));
    this.observer.started?.(this);
  }

  /** Closes `count` turns, the orders received since the last one in the first, and sends them in one frame. */
  private closeTurns(count: number): void {
    const tick = this.log.length;
    const bodies = [this.log.append(this.pending)];
    for (let i = 1; i < count; i++) bodies.push(this.log.append([]));
    this.pending = [];
    for (const seat of this.seats) seat.orders = 0;
    this.broadcast(encodeTurnsFrame(tick, bodies));
  }

  /** Ticks a late hash is waited for: the same time at every speed. */
  private get hashWindow(): number {
    return HASH_WINDOW_TICKS * this.settings.speed;
  }

  private compareLateHashes(): void {
    for (const tick of this.hashes.keys()) {
      if (tick >= this.log.length - this.hashWindow) continue;
      this.compare(tick);
    }
  }

  /** Frees the lobby seats of players who did not come back in time. */
  private expireLobbySeats(now: number): void {
    for (const seat of [...this.seats]) {
      if (seat.awaySince !== undefined && now - seat.awaySince >= this.settings.lobbyGraceMs) {
        seat.awaySince = undefined;
        this.leave(seat, now);
        if (this.stateValue === "finished") return;
      }
    }
  }

  private expireSeats(now: number): void {
    for (const seat of this.seats) {
      if (seat.awaySince !== undefined && now - seat.awaySince >= this.settings.reconnectGraceMs) {
        seat.gone = true;
        seat.awaySince = undefined;
      }
    }
    if (this.seats.every((seat) => seat.gone)) this.finish("abandoned");
    else if (
      now - this.startedAt >= this.settings.maxDurationMs ||
      this.log.byteLength >= this.settings.maxLogBytes
    ) {
      this.finish("timeout");
    }
  }

  private finish(reason: FinishReason): void {
    this.stateValue = "finished";
    if (reason !== "empty") this.broadcast(encodeServerMessage({ type: "ended", reason }));
    for (const seat of this.seats) seat.peer = undefined;
    this.pending = [];
    this.observer.finished?.(this, reason);
  }

  private lobbyChanged(now: number): void {
    const count = this.seats.length;
    if (this.settings.autoStart && count >= this.settings.capacity) {
      this.start(now);
      return;
    }
    const counting = this.settings.countdownMs > 0 && !this.held;
    const enough = this.settings.soloBots > 0 ? 1 : this.settings.minPlayers;
    if (counting && count >= enough) {
      this.startsAt ??= now + this.settings.countdownMs;
    } else this.startsAt = undefined;
    this.stateValue = this.startsAt === undefined ? "open" : "starting";
    const players = this.players();
    const startsIn = this.startsIn(now);
    for (const seat of this.seats) seat.peer?.send(this.lobbyMessage(seat, players, startsIn));
  }

  private lobbyMessage(seat: Seat, players: PlayerInfo[], startsIn: number | null): Frame {
    return encodeServerMessage({
      type: "lobby",
      game: this.id,
      visibility: this.settings.visibility,
      name: this.settings.name,
      map: this.settings.map,
      bots: this.settings.bots,
      difficulty: this.settings.difficulty,
      nations: this.settings.nations,
      teams: this.settings.teams,
      disabled: this.settings.disabled,
      capacity: this.settings.capacity,
      autoStart: this.settings.autoStart,
      speed: this.settings.speed,
      rules: this.settings.rules,
      minPlayers: this.settings.minPlayers,
      players,
      you: seat.id,
      host: this.host?.id ?? 0,
      startsIn,
      token: seat.token,
      holdable: startsIn !== null && !this.held,
      configured: seat.configured,
    });
  }

  private startedMessage(seat: Seat): Frame {
    return encodeServerMessage({
      type: "started",
      game: this.id,
      map: this.settings.map,
      seed: this.seed,
      bots: this.settings.bots,
      difficulty: this.settings.difficulty,
      nations: this.settings.nations,
      teams: this.settings.teams,
      disabled: this.settings.disabled,
      tickRate: TICK_RATE,
      speed: this.settings.speed,
      rules: this.settings.rules,
      players: this.players(),
      you: seat.id,
      token: seat.token,
    } satisfies ServerMessage);
  }

  private players(): PlayerInfo[] {
    return this.seats.map(({ id, name }) => ({ id, name }));
  }

  private broadcast(frame: Frame): void {
    for (const seat of this.seats) seat.peer?.send(frame);
  }
}
