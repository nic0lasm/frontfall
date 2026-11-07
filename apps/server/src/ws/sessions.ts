import { CloseCode, parseClientMessage, type Frame } from "@frontfall/protocol";
import type { MessageHandler, Session } from "../client-messages.ts";
import type { Clock, Timer } from "../clock.ts";
import type { Logger } from "../log.ts";
import type { Metrics } from "../metrics.ts";
import type { Directory } from "../directory.ts";
import type { Moderation } from "../moderation.ts";
import { TokenBucket } from "../rate-limit.ts";
import { peerOutbox, type Peer } from "../room-outbox.ts";
import type { ServerOptions } from "../server-options.ts";
import { DEFAULT_PING_INTERVAL_MS } from "../server-options.ts";
import type { Connection, ConnectionEvents, HttpRequest, Transport } from "../transport.ts";

/** What a connection the server turns away at once still reports: nothing it acts on. */
export const IGNORED: ConnectionEvents = {
  message: () => undefined,
  pong: () => undefined,
  error: () => undefined,
  close: () => undefined,
};

export interface SessionsSettings {
  options: ServerOptions;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
  games: Directory;
  moderation: Moderation;
  transport: Transport;
  handler: MessageHandler;
  /** The id of the account signed in on the request, if any. */
  accountOf(request: HttpRequest): string | undefined;
  clientAddress(request: HttpRequest): string;
  /** Pseudonym of an address, for the logs. */
  pseudonym(address: string): string;
}

/** The open connections that came through admission. */
export interface Sessions {
  /** Takes a connection the handshake accepted: it has to say hello soon. */
  welcome: (socket: Connection, request: HttpRequest) => ConnectionEvents;
  /** Tells every connection that has said hello. */
  broadcast: (frame: Frame) => void;
  /** Closes the connections of addresses now banned; returns how many. */
  closeBanned(): number;
  /** Starts the pings, and the closing of connections that stay out of games. */
  startHeartbeat(): Timer;
}

export function createSessions(settings: SessionsSettings): Sessions {
  const { options, clock, logger, metrics, games, moderation, transport, handler } = settings;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const messageRate = options.messageRate ?? { perSecond: 20, burst: 40 };
  const sessions = new Set<Session>();
  /** When the oldest ping a socket has not answered yet was sent. */
  const unanswered = new WeakMap<Connection, number>();
  const ping = (socket: Connection, now: number): void => {
    if (!unanswered.has(socket)) unanswered.set(socket, now);
    socket.ping();
  };

  /** What a seat is sent through: the catch-up of a rejoin goes frame by frame, the rest waits for it. */
  const peerOf = (socket: Connection): Peer =>
    peerOutbox(socket, {
      slow: () => {
        metrics.slowClients.inc();
      },
      probe: () => {
        const sentAt = clock.now();
        ping(socket, sentAt);
        clock
          .setTimeout(() => {
            const since = unanswered.get(socket);
            if (since !== undefined && since <= sentAt) socket.terminate();
          }, probeTimeoutMs)
          .unref();
      },
    });

  /** Closes the connection of a banned address, with the code that tells its page not to retry. */
  function turnAwayBanned(session: Session): boolean {
    const ban = moderation.banned(session.address, clock.now());
    if (!ban) return false;
    session.closing = true;
    metrics.rejected.inc({ reason: "banned" });
    logger.warn("connection_rejected", { client: session.client, reason: "banned" });
    session.socket.close(
      CloseCode.banned,
      ban.until === null ? "banned" : `banned until ${ban.until}`,
    );
    return true;
  }

  /** Closes connections that have stayed out of any game for too long. */
  function closeIdle(now: number): void {
    for (const session of sessions) {
      if (session.name === undefined) continue;
      if (handler.seatOf(session)) {
        session.idleSince = undefined;
        continue;
      }
      session.idleSince ??= now;
      if (now - session.idleSince >= idleTimeoutMs) {
        handler.reject(session, CloseCode.idle, "idle for too long", "idle");
      }
    }
  }

  return {
    welcome(socket, request) {
      const address = settings.clientAddress(request);
      const session: Session = {
        socket,
        address,
        client: settings.pseudonym(address),
        account: settings.accountOf(request),
        messages: new TokenBucket(messageRate.perSecond, messageRate.burst, clock.now()),
        name: undefined,
        room: undefined,
        seat: undefined,
        idleSince: undefined,
        closing: false,
        peer: peerOf(socket),
      };
      if (turnAwayBanned(session)) return IGNORED;
      sessions.add(session);

      const helloTimer = clock.setTimeout(() => {
        if (session.name === undefined) {
          handler.reject(session, CloseCode.idle, "no hello", "idle");
        }
      }, helloTimeoutMs);

      return {
        pong: () => {
          unanswered.delete(socket);
        },
        // Protocol errors, such as an oversized frame: the transport closes the socket itself.
        error: (label) => {
          metrics.rejected.inc({ reason: label });
          logger.warn("connection_rejected", { client: session.client, reason: label });
        },
        message: (frame) => {
          if (session.closing) return;
          metrics.messages.inc();
          if (!session.messages.take(clock.now())) {
            handler.reject(session, CloseCode.rateLimited, "too many messages", "rate_limited");
            return;
          }
          const parsed = parseClientMessage(frame);
          if (!parsed.ok) {
            handler.reject(session, CloseCode.invalidMessage, parsed.error, "invalid");
            return;
          }
          handler.handle(session, parsed.value);
        },
        close: (code) => {
          helloTimer.clear();
          sessions.delete(session);
          const current = handler.seatOf(session);
          // 1000 and 1001 come from a page that closed the socket itself; a lost
          // network or a phone gone to sleep closes it without a code (1006).
          if (current) {
            current.room.disconnect(current.seat, clock.now(), code === 1000 || code === 1001);
          }
          games.sweep();
        },
      };
    },
    broadcast(frame) {
      for (const session of sessions) if (session.name !== undefined) session.peer.send(frame);
    },
    closeBanned() {
      let closed = 0;
      for (const session of sessions) if (!session.closing && turnAwayBanned(session)) closed++;
      return closed;
    },
    // A socket that left a ping unanswered for a whole interval is gone, even if
    // TCP has not noticed yet. Timer drift is allowed for with half an interval.
    startHeartbeat() {
      return clock.setInterval(() => {
        const now = clock.now();
        closeIdle(now);
        for (const socket of transport.connections()) {
          const since = unanswered.get(socket);
          if (since !== undefined && now - since >= pingIntervalMs / 2) socket.terminate();
          else ping(socket, now);
        }
      }, pingIntervalMs);
    },
  };
}
