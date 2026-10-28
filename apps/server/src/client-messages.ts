import {
  CloseCode,
  encodeServerMessage,
  isDefaultRules,
  normalizeGameName,
  normalizeName,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type Frame,
  type GameOptions,
} from "@frontfall/protocol";
import type { RawData, WebSocket } from "ws";
import { isPrivateAddress } from "./address.ts";
import type { Accounts } from "./accounts.ts";
import type { MapLimits } from "./catalog.ts";
import type { Directory } from "./directory.ts";
import type { Logger } from "./log.ts";
import type { Metrics } from "./metrics.ts";
import type { Moderation } from "./moderation.ts";
import type { TokenBucket } from "./rate-limit.ts";
import type { Peer, Room, Seat } from "./room.ts";

/** WebSocket close reasons are capped at 123 bytes of UTF-8; ws throws on longer ones. */
const MAX_CLOSE_REASON_BYTES = 123;

/**
 * Cuts a reason to fit a close frame, on a character boundary. Decoding errors
 * quote what the client sent, which may be anything.
 */
export function closeReason(text: string): string {
  let reason = "";
  let bytes = 0;
  for (const char of text) {
    bytes += Buffer.byteLength(char);
    if (bytes > MAX_CLOSE_REASON_BYTES) break;
    reason += char;
  }
  return reason;
}

export function toFrame(data: RawData, isBinary: boolean): Frame {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  return isBinary
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.toString("utf8");
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  invalid_name: "the name is not allowed",
  not_found: "no such game",
  game_full: "the game is full",
  game_started: "the game has already started",
  already_in_game: "leave the current game first",
  not_in_game: "you are not in a game",
  not_host: "only the host can change or start the game",
  too_many_games: "too many games in progress",
  token_invalid: "this game is over or the seat was given up",
  token_in_use: "the seat is still connected",
  invalid_settings: "no such map, or too many bots or seats for it",
  restarting: "the server is about to restart; try again in a few minutes",
  invalid_game_name: "the game name is not allowed",
  not_enough_players: "wait for more players before starting",
  too_many_lobbies: "you already have three games waiting to start",
  removed: "the host removed you from this game",
  too_many_seats: "too many players from your network are already in this game",
  too_many_reports: "you have sent many reports lately; try again in a few minutes",
};

/**
 * Seats a game keeps with these options: those the host asked for, fewer on a
 * small map or with many bots, never fewer than the players already in. Bots
 * beyond the server's cap or that leave no seat for them give undefined.
 */
function seatsFor(
  options: GameOptions,
  maps: MapLimits,
  maxBots: number,
  players: number,
): number | undefined {
  const maxPlayers = maps.get(options.map)?.max;
  if (maxPlayers === undefined || options.bots > maxBots) return undefined;
  const seats = Math.min(options.capacity, maxPlayers - options.bots);
  return seats >= Math.max(players, 1) ? seats : undefined;
}

/** What one WebSocket connection has done so far. */
export interface Session {
  readonly socket: WebSocket;
  readonly peer: Peer;
  /** Address of the player, for per-address limits. Never logged. */
  readonly address: string;
  /** Pseudonym of the client address, for the logs. */
  readonly client: string;
  readonly messages: TokenBucket;
  /** Id of the account signed in when the socket opened: it plays under the account's name. */
  readonly account: string | undefined;
  name: string | undefined;
  room: Room | undefined;
  seat: Seat | undefined;
  /** Since when the connection has been in no game. */
  idleSince: number | undefined;
  /** Rejected: whatever else it sends is dropped. */
  closing: boolean;
}

/** What the handling of messages needs from the server around it. */
export interface MessageContext {
  readonly games: Directory;
  /** Accounts, when players may sign in: their names are theirs alone. */
  readonly accounts?: Accounts | undefined;
  readonly maps: MapLimits;
  /** Bots the host of a game may add, within the map's player count. */
  readonly maxBots: number;
  readonly simulation: string;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly moderation: Moderation;
  /** Whether the server has begun to close: no new game opens. */
  stopping(): boolean;
  /** The announcement of a restart due after `now`, if one is. */
  maintenance(now: number): Frame | undefined;
}

/**
 * The answers to what a connection sends, from `hello` to its orders, and
 * how a connection that broke the rules is closed.
 */
export function messageHandler(ctx: MessageContext): {
  handle: (session: Session, message: ClientMessage) => void;
  reject: (session: Session, code: number, reason: string, label: string) => void;
  seatOf: (session: Session) => { room: Room; seat: Seat } | undefined;
} {
  function reply(session: Session, code: ErrorCode, message = ERROR_TEXT[code]): void {
    session.peer.send(encodeServerMessage({ type: "error", code, message }));
  }

  /** Closes a connection that broke the rules, and records why. */
  function reject(session: Session, code: number, reason: string, label: string): void {
    if (session.closing) return;
    session.closing = true;
    ctx.metrics.rejected.inc({ reason: label });
    ctx.logger.warn("connection_rejected", { client: session.client, reason: label });
    session.socket.close(code, closeReason(reason));
  }

  /** The seat of this connection, if it still holds one in a game. */
  function seatOf(session: Session): { room: Room; seat: Seat } | undefined {
    const { room, seat } = session;
    if (!room || !seat || !room.holds(seat) || seat.peer !== session.peer) return undefined;
    return { room, seat };
  }

  function enter(session: Session, room: Room | undefined, missing: ErrorCode): void {
    if (!room) {
      reply(session, missing);
      return;
    }
    const seat = room.join(session.name ?? "", session.peer, Date.now(), session.address);
    if (typeof seat === "string") {
      reply(session, seat);
      return;
    }
    session.room = room;
    session.seat = seat;
    session.idleSince = undefined;
  }

  function handle(session: Session, message: ClientMessage): void {
    if (message.type === "hello") {
      if (session.name !== undefined) {
        reject(session, CloseCode.invalidMessage, "hello was already sent", "invalid");
        return;
      }
      // Not reject(): a stale page is not misbehaving, so it is not counted as
      // rejected, but nothing it sends while the close completes is handled.
      if (message.build && !sameBuild(message.build, ctx.simulation)) {
        session.closing = true;
        session.socket.close(CloseCode.versionMismatch, `build ${ctx.simulation} required`);
        return;
      }
      if (message.version !== PROTOCOL_VERSION) {
        session.closing = true;
        session.socket.close(
          CloseCode.versionMismatch,
          `protocol ${String(PROTOCOL_VERSION)} required`,
        );
        return;
      }
      const account =
        session.account === undefined ? undefined : ctx.accounts?.get(session.account);
      const name = normalizeName(account?.name ?? message.name);
      if (!name.ok) {
        reply(session, "invalid_name", name.error);
        return;
      }
      if (!account && ctx.accounts?.owner(name.name)) {
        reply(session, "invalid_name", "this name belongs to an account");
        return;
      }
      session.name = name.name;
      session.idleSince = Date.now();
      session.peer.send(encodeServerMessage({ type: "welcome", version: PROTOCOL_VERSION }));
      const now = Date.now();
      const maintenance = ctx.maintenance(now);
      if (maintenance) session.peer.send(maintenance);
      return;
    }
    if (session.name === undefined) {
      reject(session, CloseCode.invalidMessage, "hello must come first", "invalid");
      return;
    }

    const current = seatOf(session);
    if (current) current.room.touch(current.seat, Date.now());
    switch (message.type) {
      case "play":
      case "create":
      case "join":
      case "rejoin":
        if (current) {
          reply(session, "already_in_game");
          return;
        }
        // Players of a running game may still come back while the server drains.
        if (ctx.stopping() && message.type !== "rejoin") {
          reply(session, "restarting");
          return;
        }
        if (message.type === "play") {
          const name = gameName(message.name, session.name);
          enter(session, ctx.games.quickMatch(session.address, name), "too_many_games");
        } else if (message.type === "create") {
          const visibility = message.visibility ?? "private";
          let name: string | null = null;
          if (visibility === "public") {
            // Without a name of their own, the player gets one that is always valid, as with play.
            if (message.name === undefined) name = gameName(undefined, session.name);
            else {
              const checked = normalizeGameName(message.name);
              if (!checked.ok) {
                reply(session, "invalid_game_name", checked.error);
                return;
              }
              name = checked.name;
            }
          }
          if (ctx.games.atLobbyLimit(session.address)) {
            reply(session, "too_many_lobbies");
            return;
          }
          const room = ctx.games.create({ kind: "hosted", visibility, name }, session.address);
          enter(session, room, "too_many_games");
        } else if (message.type === "join")
          enter(session, ctx.games.find(message.game), "not_found");
        else rejoin(session, message.token, message.from);
        return;
      case "configure": {
        if (!current) {
          reply(session, "not_in_game");
          return;
        }
        // A host's form runs ahead of the answers: a refusal sends the settings that hold.
        const refuse = (code: ErrorCode, text?: string): void => {
          reply(session, code, text);
          if (message.seq !== undefined) {
            current.room.refusedConfigure(current.seat, message.seq, Date.now());
          }
        };
        const seats = seatsFor(message.options, ctx.maps, ctx.maxBots, current.room.playerCount);
        // A public game runs at the pace everyone expects (R-MODE-07), with the default rules (R-MODE-08).
        const isPublic = current.room.settings.visibility === "public";
        const fast = (message.options.speed ?? 1) !== 1 && isPublic;
        const ruled = message.options.rules !== undefined && !isDefaultRules(message.options.rules);
        if (seats === undefined || fast || (ruled && isPublic)) {
          refuse("invalid_settings");
          return;
        }
        let name: string | undefined;
        if (message.name !== undefined && current.room.settings.visibility === "public") {
          const checked = normalizeGameName(message.name);
          if (!checked.ok) {
            refuse("invalid_game_name", checked.error);
            return;
          }
          name = ctx.games.uniqueName(checked.name, current.room);
        }
        // A quick game keeps filling in with the new map's bots.
        const soloBots =
          current.room.settings.soloBots > 0 ? (ctx.maps.get(message.options.map)?.bots ?? 0) : 0;
        const error = current.room.configure(
          current.seat,
          { ...message.options, capacity: seats, soloBots, ...(name !== undefined && { name }) },
          Date.now(),
          message.seq,
        );
        if (error) refuse(error);
        return;
      }
      case "start": {
        const error = current ? current.room.requestStart(current.seat, Date.now()) : "not_in_game";
        if (error) reply(session, error);
        return;
      }
      case "hold": {
        const error = current ? current.room.hold(current.seat, Date.now()) : "not_in_game";
        if (error) reply(session, error);
        return;
      }
      case "active":
        return;
      case "kick": {
        const error = current
          ? current.room.kick(current.seat, message.player, Date.now())
          : "not_in_game";
        if (error) reply(session, error);
        else ctx.games.sweep();
        return;
      }
      case "report": {
        if (!current) {
          reply(session, "not_in_game");
          return;
        }
        const target = current.room.seatOf(message.player);
        // Players of one public address share one reference: a report of one of them names
        // the reporter too. A LAN without a proxy, or a test on one machine, has only that one.
        const sameAddress =
          target?.address === session.address && !isPrivateAddress(session.address);
        if (!target || target === current.seat || sameAddress) {
          reply(session, "not_found");
          return;
        }
        const now = Date.now();
        const taken = ctx.moderation.report(
          { game: current.room.id, reason: message.reason, player: target.id, name: target.name },
          session.address,
          target.address,
          now,
        );
        if (!taken) {
          reply(session, "too_many_reports");
          return;
        }
        ctx.metrics.reports.inc({ reason: message.reason });
        ctx.logger.info("player_reported", {
          game: current.room.id,
          player: target.id,
          reason: message.reason,
        });
        session.peer.send(encodeServerMessage({ type: "reported", player: target.id }));
        return;
      }
      case "leave":
        if (!current) return;
        current.room.leave(current.seat, Date.now());
        session.room = undefined;
        session.seat = undefined;
        session.idleSince = Date.now();
        session.peer.send(encodeServerMessage({ type: "ended", reason: "left" }));
        ctx.games.sweep();
        return;
      case "hash":
        current?.room.reportHash(current.seat, message.tick, message.hash);
        return;
      case "order":
        current?.room.submit(current.seat, message.order);
        return;
    }
  }

  function rejoin(session: Session, token: string, from: number): void {
    const found = ctx.games.findSeat(token);
    const error = found
      ? found.room.rejoin(found.seat, session.peer, from, Date.now())
      : "token_invalid";
    if (error || !found) {
      reply(session, error ?? "token_invalid");
      return;
    }
    session.room = found.room;
    session.seat = found.seat;
    session.idleSince = undefined;
    ctx.metrics.rejoins.inc();
    ctx.logger.info("player_rejoined", { game: found.room.id, player: found.seat.id, from });
  }

  return { handle, reject, seatOf };
}

/** Builds match, or one side is a development build. */
function sameBuild(client: string, server: string): boolean {
  return client === server || client === "dev" || server === "dev";
}

/** What a public game opened without a name is listed as. */
function defaultGameName(player: string | undefined): string {
  return player ? `${player}'s game` : "Frontfall game";
}

/** The name asked for a game "play" may open, or a default when it is missing or refused. */
function gameName(asked: string | undefined, player: string | undefined): string {
  for (const candidate of [asked, defaultGameName(player)]) {
    if (candidate === undefined) continue;
    const checked = normalizeGameName(candidate);
    if (checked.ok) return checked.name;
  }
  return defaultGameName(undefined);
}
