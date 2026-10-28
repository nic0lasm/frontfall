import { randomInt } from "node:crypto";
import { MAX_GAME_NAME_LENGTH, isDefaultRules, type PublicGame } from "@frontfall/protocol";
import { newGameId } from "./ids.ts";
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

export interface DirectoryOptions {
  maxRooms: number;
  /** Games not yet started, public or private, that one owner may hold. */
  maxLobbiesPerOwner?: number;
  /** Public games opened by "play": they start on their own after a countdown. */
  publicGame: Omit<RoomSettings, "visibility" | "name">;
  /** Games a player creates and starts themselves; public ones are listed. */
  privateGame: Omit<RoomSettings, "visibility" | "name">;
  observer?: RoomObserver;
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
   * under `name`; undefined when the server is full. The lobbies an owner
   * holds do not count here: a second "play" joins the game the first opened.
   */
  quickMatch(owner: string | undefined, name: string): Room | undefined {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      // Only quick games still counting down: they keep the promise of starting on their own.
      if (!waiting(room) || room.settings.visibility !== "public") continue;
      if (room.settings.countdownMs <= 0 || room.isHeld) continue;
      if (room.playerCount >= room.settings.capacity) continue;
      // "Play now" promises the usual game: the default special rules only (R-MODE-08).
      if (!isDefaultRules(room.settings.rules)) continue;
      // A game that would turn the player away is no match for them.
      if (owner !== undefined && (room.bars(owner) || room.atSeatLimit(owner))) continue;
      if (!best || room.playerCount > best.playerCount) best = room;
    }
    return best ?? this.create({ kind: "quick", name }, owner, false);
  }

  /** Whether `owner` already holds as many games not yet started as one address may. */
  atLobbyLimit(owner: string): boolean {
    return this.lobbiesOf(owner) >= (this.options.maxLobbiesPerOwner ?? Infinity);
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
    const room = new Room(newGameId(), settings, randomInt(2 ** 31), this.options.observer, owner);
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
    );
    if (room) this.rooms.set(room.id, room);
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

  /** Advances every game by one tick and forgets the finished ones. */
  update(now: number): void {
    for (const [id, room] of this.rooms) {
      room.update(now);
      if (room.state === "finished") this.rooms.delete(id);
    }
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
