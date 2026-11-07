import { CloseCode } from "@frontfall/protocol";
import type { Clock } from "../clock.ts";
import type { Metrics } from "../metrics.ts";
import { isAllowedOrigin } from "../origin.ts";
import { AddressRate } from "../rate-limit.ts";
import type { ServerOptions } from "../server-options.ts";
import type { Connection, ConnectionEvents, HttpRequest, UpgradeAnswer } from "../transport.ts";
import { IGNORED } from "./sessions.ts";

export interface AdmissionSettings {
  options: ServerOptions;
  clock: Clock;
  metrics: Metrics;
  /** Open WebSockets right now. */
  connectionCount(): number;
  clientAddress(request: HttpRequest): string;
  /** Takes a connection that was let in. */
  welcome(socket: Connection, request: HttpRequest): ConnectionEvents;
}

/**
 * Decides whether a request to open a WebSocket is let in: the right path
 * and origin, room on the server, and room for this address. The answer of a
 * full server is a connection closed at once; of an address over its limits, a 429.
 */
export function createAdmission(
  settings: AdmissionSettings,
): (request: HttpRequest) => UpgradeAnswer {
  const { options, clock, metrics } = settings;
  // Players behind one home router or a mobile carrier share an address.
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 16;
  const maxConnections = options.maxConnections ?? 5_000;
  // A whole household reconnecting after a restart fits in the burst; a script
  // that opens connections in a loop runs dry at one every two seconds.
  const upgradeRate = options.upgradeRate ?? { perSecond: 0.5, burst: 40 };
  const connectionsByAddress = new Map<string, number>();
  const upgrades = new AddressRate(upgradeRate.perSecond, upgradeRate.burst, clock.now());

  return (request) => {
    const path =
      request.url.startsWith("//") || request.url.includes("\\")
        ? ""
        : new URL(request.url, "http://localhost").pathname;
    if (path !== "/ws" || !isAllowedOrigin(request.header("origin"), options.allowedOrigin)) {
      return { refuse: 403 };
    }
    if (settings.connectionCount() >= maxConnections) {
      // Opened and closed at once with a code the page understands: it says the
      // server is full and waits longer, where a refused handshake looks like a network fault.
      metrics.refused.inc({ reason: "connections" });
      return {
        accept: (socket) => {
          socket.close(CloseCode.full, "server full");
          return IGNORED;
        },
      };
    }
    const address = settings.clientAddress(request);
    const connections = connectionsByAddress.get(address) ?? 0;
    if (connections >= maxConnectionsPerAddress || !upgrades.take(address, clock.now())) {
      metrics.refused.inc({ reason: "address" });
      return { refuse: 429 };
    }
    connectionsByAddress.set(address, connections + 1);
    return {
      accept: (socket) => settings.welcome(socket, request),
      // When the connection closes, not the WebSocket: a refused handshake never
      // makes one, and its slot would otherwise stay taken until the server restarts.
      released: () => {
        const remaining = (connectionsByAddress.get(address) ?? 1) - 1;
        if (remaining > 0) connectionsByAddress.set(address, remaining);
        else connectionsByAddress.delete(address);
      },
    };
  };
}
