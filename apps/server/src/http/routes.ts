import type { Auth } from "../auth.ts";
import { isLocalRequest, isLoopbackRequest } from "../address.ts";
import {
  cachedJson,
  SECURITY_HEADERS,
  sendCachedJson,
  sendJson,
  serveStatic,
  type CachedJson,
} from "../http-replies.ts";
import { runningGames } from "../lifecycle.ts";
import type { Metrics, Snapshot } from "../metrics.ts";
import type { ServerOptions } from "../server-options.ts";
import { statusPage } from "../status-page.ts";
import type { TurnTimer } from "../turn-timer.ts";
import type { HttpRequest, HttpResponse } from "../transport.ts";
import { usageTable } from "../usage.ts";
import type { UsageInbox } from "../usage-http.ts";
import { announce, bansAnswer, errorsAnswer, reportsAnswer, type AdminContext } from "./admin.ts";

/** What the routes read and change. */
export interface RouteContext extends AdminContext {
  options: ServerOptions;
  metrics: Metrics;
  auth: Auth | undefined;
  /** Where players report errors and what they do (POST /api/usage). */
  reports: UsageInbox;
  timer: TurnTimer;
  clientAddress(request: HttpRequest): string;
  /** Open WebSockets right now. */
  connectionCount(): number;
}

/**
 * One step of the route table. A route that takes the request answers it and
 * returns true; one that does not returns false, and the next step is tried.
 */
export interface Route {
  readonly name: string;
  handle(request: HttpRequest, response: HttpResponse, path: string): boolean;
}

/** A route for exactly `path`, taking `methods`, or every method when none are given. */
function at(
  name: string,
  path: string,
  methods: readonly string[] | undefined,
  reply: (request: HttpRequest, response: HttpResponse) => void,
): Route {
  return {
    name,
    handle(request, response, requested) {
      if (requested !== path || (methods && !methods.includes(request.method))) return false;
      reply(request, response);
      return true;
    },
  };
}

const READ = ["GET", "HEAD"];

/**
 * The routes in the order they are tried, which decides what a request gets.
 * Those before "methods" answer whatever the method is: the admin routes only
 * to a request from inside the container, /api/usage to a POST. "methods"
 * turns away anything but GET and HEAD with a 405, so every route after it
 * reads only. Tests pin the status of each path and method (routes.test.ts).
 */
export function routeTable(ctx: RouteContext): readonly Route[] {
  const { options, clock, games, metrics, usage, lifecycle } = ctx;
  /** The last public list sent, and when it was built. */
  let gameList: { at: number; body: CachedJson } | undefined;
  const gameListMs = options.gameListMs ?? 1000;
  const stallAfterMs = options.stallAfterMs ?? 5000;

  const health = (): "ok" | "stopping" | "stalled" => {
    // An event loop that is blocked cannot answer at all; this catches a turn
    // timer that has stopped or fallen far behind while requests still get through.
    if (lifecycle.stopping()) return "stopping";
    return clock.monotonic() - ctx.timer.lastTurnAt() > stallAfterMs ? "stalled" : "ok";
  };
  const snapshot = (): Snapshot => {
    const counts = { open: 0, starting: 0, running: 0 };
    let players = 0;
    for (const room of games.all()) {
      if (room.state !== "finished") counts[room.state]++;
      players += room.connectedCount;
    }
    return { games: counts, players, connections: ctx.connectionCount() };
  };

  return [
    at("healthz", "/healthz", undefined, (_request, response) => {
      const status = health();
      response.send(
        status === "ok" ? 200 : 503,
        {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "x-frontfall-version": options.version,
          ...(options.release ? { "x-frontfall-release": options.release } : {}),
        },
        status,
      );
    }),
    {
      name: "admin-maintenance",
      handle(request, response, path) {
        if (path !== "/admin/maintenance" || !isLoopbackRequest(request)) return false;
        announce(ctx, request, response);
        return true;
      },
    },
    {
      name: "admin",
      handle(request, response, path) {
        if (!path.startsWith("/admin/")) return false;
        if (!isLoopbackRequest(request)) response.send(404);
        else if (path === "/admin/reports") reportsAnswer(ctx, request, response);
        else if (path === "/admin/bans") bansAnswer(ctx, request, response);
        else if (path === "/admin/errors") errorsAnswer(ctx, request, response);
        else response.send(404);
        return true;
      },
    },
    {
      name: "auth",
      handle: (request, response, path) =>
        ctx.auth?.handle(request, response, path, ctx.clientAddress(request)) ?? false,
    },
    // Guests only: the page shows no sign-in button.
    at("guest-me", "/api/me", READ, (_request, response) => {
      sendJson(response, { providers: [], account: null });
    }),
    at("usage", "/api/usage", undefined, (request, response) => {
      ctx.reports.handle(request, response, ctx.clientAddress(request));
    }),
    {
      name: "methods",
      handle(request, response) {
        if (READ.includes(request.method)) return false;
        response.send(405, { allow: "GET, HEAD" });
        return true;
      },
    },
    at("games", "/api/games", undefined, (request, response) => {
      // Every menu asks every few seconds: the list is built once a second at most.
      const now = clock.monotonic();
      if (gameList === undefined || now - gameList.at >= gameListMs) {
        gameList = {
          at: now,
          body: cachedJson({ games: games.publicGames(), running: runningGames(games) }),
        };
      }
      sendCachedJson(request, response, gameList.body);
    }),
    at("status", "/api/status", undefined, (_request, response) => {
      sendJson(response, lifecycle.status());
    }),
    at("status-page", "/status", undefined, (request, response) => {
      response.send(
        200,
        {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...SECURITY_HEADERS,
        },
        request.method === "HEAD"
          ? undefined
          : statusPage(
              lifecycle.status(),
              usageTable(usage.export(clock.now())) + (options.statusSections?.() ?? ""),
            ),
      );
    }),
    at("stats", "/api/stats", undefined, (_request, response) => {
      // Totals by the day: a minute late is fine, and spares the server repeated scrapes.
      sendJson(response, usage.export(clock.now()), "public, max-age=60");
    }),
    {
      name: "metrics",
      handle(request, response, path) {
        if (path !== "/metrics" || !isLocalRequest(request)) return false;
        response.send(
          200,
          { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store" },
          metrics.render(snapshot(), usage.renderMetrics()),
        );
        return true;
      },
    },
    {
      name: "static",
      handle(request, response, path) {
        serveStatic(options.staticRoot, path, request, response);
        return true;
      },
    },
  ];
}

/** Answers HTTP requests by the first route that takes them. */
export function createRoutes(
  ctx: RouteContext,
): (request: HttpRequest, response: HttpResponse) => void {
  const routes = routeTable(ctx);
  return (request, response) => {
    // `//host/path` or `/\host/path` would parse as another host's path, past a proxy's matchers.
    if (
      !request.url.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.includes("\\")
    ) {
      response.send(400);
      return;
    }
    const path = new URL(request.url, "http://localhost").pathname;
    for (const route of routes) if (route.handle(request, response, path)) return;
  };
}
