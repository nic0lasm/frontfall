import { MAX_GAME_NAME_LENGTH, isDefaultRules, type PublicGame } from "@frontfall/protocol";
import { systemIds, type Ids } from "./ids.ts";
import {
  Room,
  type FinishReason,
  type RoomObserver,
  type RoomSettings,
  type Seat,
} from "./room.ts";
import type { LoadedGame } from "./saved-games.ts";

/** Games the public list shows at most. */
export const MAX_LISTED_GAMES = 100;

/**
 * Games not over that one address may have opened and still play in, unless
 * set otherwise: enough for a household or a phone network's shared address,
 * few enough that a handful of addresses cannot fill the server. 0 lifts it.
 */
export const MAX_GAMES_PER_OWNER = 10;

export interface DirectoryOptions {
  maxRooms: number;
  /** Players seated at once, in every game; beyond, no new player is let in. */
  maxPlayers?: number;
  /** Bytes the turn logs of every game may take together; beyond, no new player is let in. */
  maxLogBytes?: number;
  /** Games not yet started, public or private, that one owner may hold. */
  maxLobbiesPerOwner?: number;
  /**
   * Games not over, waiting or running, that one owner opened and still
   * plays in: without it, solo games started one after another would hold
   * every room of the server.
   */
  maxGamesPerOwner?: number;
  /** Public games opened by "play": they start on their own after a countdown. */
  publicGame: Omit<RoomSettings, "visibility" | "name">;
  /** Games a player creates and starts themselves; public ones are listed. */
  privateGame: Omit<RoomSettings, "visibility" | "name">;
  observer?: RoomObserver;
  /** Where game ids, seeds and reconnect tokens are drawn. */
  ids?: Ids;
}

/** How a game is opened: from "play", or created by a host who starts it. */
export type Opening =
  | { kind: "quick"; name: string }
  | { kind: "hosted"; visibility: RoomSettings["visibility"]; name: string | null };

/** Every game of the server, by id, from creation until it finishes. */
export class Directory {
  private readonly rooms = new Map<string, Room>();
  /** When each room opened, to list older games first among equals. */
  private readonly openedAt = new WeakMap<Room, number>();
  /** Players seated and turn log bytes in every game, as of the last tick. */
  private seated = 0;
  private logBytes = 0;
  private opened = 0;

  constructor(private readonly options: DirectoryOptions) {}

  get size(): number {
    return this.rooms.size;
  }

  all(): IterableIterator<Room> {
    return this.rooms.values();
  }

  find(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /**
   * The fullest quick game still waiting with a seat free, or a new one
   * under `name`; undefined when the server is full, or when `owner` may
   * open no other game. The lobbies an owner holds do not count here: a
   * second "play" joins the game the first opened.
   */
  quickMatch(owner: string | undefined, name: string): Room | undefined {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      // Only quick games still counting down: they keep the promise of starting on their own.
      if (!waiting(room) || room.settings.visibility !== "public") continue;
      if (room.settings.countdownMs <= 0 || room.isHeld) continue;
      if (room.playerCount >= room.settings.capacity) continue;
      // "Play now" promises the usual game: the options a host changed take it out (R-MODE-04).
      if (!this.hasPublicDefaults(room)) continue;
      // A game that would turn the player away is no match for them.
      if (owner !== undefined && (room.bars(owner) || room.atSeatLimit(owner))) continue;
      if (!best || room.playerCount > best.playerCount) best = room;
    }
    if (best) return best;
    if (owner !== undefined && this.atGameLimit(owner)) return undefined;
    return this.create({ kind: "quick", name }, owner, false);
  }

  /**
   * Whether `owner` may open no other game: they hold as many games not yet
   * started as one address may, or as many games not over.
   */
  atLobbyLimit(owner: string): boolean {
    return (
      this.lobbiesOf(owner) >= (this.options.maxLobbiesPerOwner ?? Infinity) ||
      this.atGameLimit(owner)
    );
  }

  /**
   * Whether `owner` already holds as many games they opened as one address
   * may: lobbies, and running games they still play in. One they left, or
   * that ended, frees its place.
   */
  atGameLimit(owner: string): boolean {
    let count = 0;
    for (const room of this.rooms.values()) {
      if (room.owner !== owner || room.state === "finished") continue;
      if (waiting(room) || room.hasSeatFrom(owner)) count++;
    }
    const limit = this.options.maxGamesPerOwner ?? MAX_GAMES_PER_OWNER;
    return limit > 0 && count >= limit;
  }

  /** Whether the host kept every option of a quick game as "play" opened it. */
  private hasPublicDefaults(room: Room): boolean {
    const { settings } = room;
    const defaults = this.options.publicGame;
    return (
      settings.map === defaults.map &&
      settings.bots === defaults.bots &&
      settings.difficulty === defaults.difficulty &&
      settings.nations === defaults.nations &&
      settings.teams === defaults.teams &&
      settings.disabled === defaults.disabled &&
      settings.autoStart === defaults.autoStart &&
      settings.speed === defaults.speed &&
      isDefaultRules(settings.rules)
    );
  }

  /** Opens a game. `owner`, the creator's address, caps the lobbies one person holds. */
  create(opening: Opening, owner?: string, limited = true): Room | undefined {
    if (this.rooms.size >= this.options.maxRooms) return undefined;
    if (limited && owner !== undefined && this.atLobbyLimit(owner)) return undefined;
    const settings: RoomSettings =
      opening.kind === "quick"
        ? { ...this.options.publicGame, visibility: "public", name: this.uniqueName(opening.name) }
        : {
            ...this.options.privateGame,
            visibility: opening.visibility,
            name:
              opening.visibility === "public" ? this.uniqueName(opening.name ?? "Frontfall") : null,
            // A public game waits for at least one opponent.
            minPlayers:
              opening.visibility === "public"
                ? this.options.publicGame.minPlayers
                : this.options.privateGame.minPlayers,
            // The host sets the bots of their own game.
            soloBots: 0,
          };
    const ids = this.options.ids ?? systemIds;
    const room = new Room(ids.gameId(), settings, ids.seed(), this.options.observer, owner, ids);
    this.rooms.set(room.id, room);
    this.openedAt.set(room, this.opened++);
    return room;
  }

  /**
   * `name`, or `name (2)`, `name (3)`... so that two public games still
   * waiting never share a name. `except` is the game being renamed.
   */
  uniqueName(name: string, except?: Room): string {
    const taken = new Set<string>();
    for (const room of this.rooms.values()) {
      if (room === except || !waiting(room) || room.settings.name === null) continue;
      taken.add(room.settings.name.toLowerCase());
    }
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` (${String(n)})`;
      const base = Array.from(name)
        .slice(0, MAX_GAME_NAME_LENGTH - suffix.length)
        .join("")
        .trimEnd();
      const candidate = base + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /**
   * Takes back a game saved by an earlier run, under this run's limits;
   * undefined when it cannot.
   */
  restore(saved: LoadedGame, now: number): Room | undefined {
    if (this.rooms.size >= this.options.maxRooms || this.rooms.has(saved.id)) return undefined;
    const { visibility } = saved.settings;
    const base = visibility === "public" ? this.options.publicGame : this.options.privateGame;
    const room = Room.restore(
      { ...saved, settings: { ...base, ...saved.settings } },
      this.options.observer ?? {},
      now,
      this.options.ids,
    );
    if (room) {
      this.rooms.set(room.id, room);
      this.openedAt.set(room, this.opened++);
    }
    return room;
  }

  private lobbiesOf(owner: string): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      if (room.owner === owner && waiting(room)) count++;
    }
    return count;
  }

  /** The game and seat a reconnect token belongs to, before the start or after. */
  findSeat(token: string): { room: Room; seat: Seat } | undefined {
    for (const room of this.rooms.values()) {
      if (room.state === "finished") continue;
      const seat = room.seatFor(token);
      if (seat) return { room, seat };
    }
    return undefined;
  }

  /**
   * Whether the server holds all the players it can serve well: new players
   * are turned away, those of a game under way still come back. Counted
   * afresh at each tick, and between two as players are seated.
   */
  get full(): boolean {
    return (
      this.seated >= (this.options.maxPlayers ?? Infinity) ||
      this.logBytes >= (this.options.maxLogBytes ?? Infinity)
    );
  }

  /** Counts a player just seated, so that a burst of arrivals within a tick cannot overshoot. */
  admit(): void {
    this.seated++;
  }

  /** Players seated in every game, as of the last tick. */
  get players(): number {
    return this.seated;
  }

  /**
   * Advances games by one tick and forgets the finished ones: every game, or
   * with `slice`, the share of them whose turn falls in that pass. Spread over
   * a tick, the sends of many games never hold the server for long at once.
   */
  update(now: number, slice?: { index: number; of: number }): void {
    for (const [id, room] of this.rooms) {
      if (slice && (this.openedAt.get(room) ?? 0) % slice.of !== slice.index) continue;
      room.update(now);
      if (room.state === "finished") this.rooms.delete(id);
    }
    if (slice && slice.index !== 0) return;
    let seated = 0;
    let logBytes = 0;
    for (const room of this.rooms.values()) {
      seated += room.playerCount;
      logBytes += room.log.byteLength;
    }
    this.seated = seated;
    this.logBytes = logBytes;
  }

  /** Forgets games that finished between two ticks, such as a lobby everyone left. */
  sweep(): void {
    for (const [id, room] of this.rooms) {
      if (room.state === "finished") this.rooms.delete(id);
    }
  }

  /**
   * The public list: games waiting first, those with the fewest seats left
   * first, then the oldest; running games after them. At most
   * `MAX_LISTED_GAMES`, and nothing that would let anyone take a seat.
   */
  publicGames(): PublicGame[] {
    const rooms = [...this.rooms.values()].filter(
      (room) => room.settings.visibility === "public" && room.state !== "finished",
    );
    const rank = (room: Room): [number, number, number] => [
      waiting(room) ? 0 : 1,
      room.settings.capacity - room.playerCount,
      this.openedAt.get(room) ?? 0,
    ];
    rooms.sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    return rooms.slice(0, MAX_LISTED_GAMES).map((room) => ({
      id: room.id,
      name: room.settings.name ?? "",
      host: room.hostName,
      map: room.settings.map,
      bots: room.settings.bots,
      nations: room.settings.nations,
      teams: room.settings.teams,
      disabled: room.settings.disabled,
      rules: room.settings.rules,
      players: room.playerCount,
      capacity: room.settings.capacity,
      state: waiting(room) ? "waiting" : "running",
    }));
  }

  stopAll(reason?: FinishReason): void {
    for (const room of this.rooms.values()) room.stop(reason);
    this.rooms.clear();
  }
}

/** Still in its lobby: open, or counting down. */
function waiting(room: Room): boolean {
  return room.state === "open" || room.state === "starting";
}
