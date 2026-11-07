import type { Clock } from "../clock.ts";
import type { Directory } from "../directory.ts";
import { sendJson } from "../http-replies.ts";
import type { Lifecycle } from "../lifecycle.ts";
import { runningGames } from "../lifecycle.ts";
import type { Logger } from "../log.ts";
import type { Moderation } from "../moderation.ts";
import { validTarget } from "../moderation.ts";
import type { HttpRequest, HttpResponse } from "../transport.ts";
import type { UsageStats } from "../usage.ts";
import type { Sessions } from "../ws/sessions.ts";

/** What the admin routes read and change. */
export interface AdminContext {
  clock: Clock;
  logger: Logger;
  games: Directory;
  moderation: Moderation;
  usage: UsageStats;
  lifecycle: Lifecycle;
  sessions: Sessions;
}

const text = { "content-type": "text/plain" };

/**
 * POST /admin/maintenance?minutes=N, from inside the container: tells every
 * player the server restarts in N minutes; 0 calls it off. The answer gives
 * the games running, which the restart would stop.
 */
export function announce(ctx: AdminContext, request: HttpRequest, response: HttpResponse): void {
  const minutes = Number(new URL(request.url, "http://localhost").searchParams.get("minutes"));
  if (request.method !== "POST" || !Number.isFinite(minutes) || minutes < 0 || minutes > 120) {
    response.send(400, text, "POST ?minutes=0 to 120");
    return;
  }
  ctx.sessions.broadcast(ctx.lifecycle.announce(minutes));
  ctx.logger.info("maintenance_announced", { minutes });
  sendJson(response, { minutes, running: runningGames(ctx.games) });
}

/** GET /admin/reports?days=N, from inside the container: the reports of the last N days, 30 at most. */
export function reportsAnswer(
  ctx: AdminContext,
  request: HttpRequest,
  response: HttpResponse,
): void {
  const days = Number(new URL(request.url, "http://localhost").searchParams.get("days") ?? 30);
  if (request.method !== "GET" || !Number.isFinite(days) || days <= 0) {
    response.send(400, text, "GET ?days=1 to 30");
    return;
  }
  sendJson(response, ctx.moderation.read(ctx.clock.now(), Math.min(days, 30)));
}

/**
 * GET /admin/errors?days=N, from inside the container: the errors players'
 * pages reported in the last N days, 30 at most, grouped, the most reported first.
 */
export function errorsAnswer(
  ctx: AdminContext,
  request: HttpRequest,
  response: HttpResponse,
): void {
  const days = Number(new URL(request.url, "http://localhost").searchParams.get("days") ?? 7);
  if (request.method !== "GET" || !Number.isInteger(days) || days <= 0) {
    response.send(400, text, "GET ?days=1 to 30");
    return;
  }
  sendJson(response, ctx.usage.errors.read(ctx.clock.now(), Math.min(days, 30)));
}

/**
 * /admin/bans, from inside the container. GET lists the bans. POST
 * ?target=T[&days=N][&note=text] bans an address or a reference, for N days
 * or for good; POST without a target reads the ban file again. DELETE
 * ?target=T lifts a ban. Connections of addresses now banned are closed.
 */
export function bansAnswer(ctx: AdminContext, request: HttpRequest, response: HttpResponse): void {
  const { moderation, logger } = ctx;
  const query = new URL(request.url, "http://localhost").searchParams;
  const now = ctx.clock.now();
  const target = query.get("target");
  const days = query.has("days") ? Number(query.get("days")) : undefined;
  const usage =
    "GET, POST ?target=address-or-reference&days=N&note=text, POST to reload, DELETE ?target=";
  if (target !== null && !validTarget(target)) {
    response.send(400, text, usage);
    return;
  }
  if (request.method === "POST" && target === null && days === undefined) {
    try {
      moderation.reload();
    } catch (error) {
      response.send(422, text, (error as Error).message);
      return;
    }
    logger.info("bans_reloaded", { bans: moderation.list(now).length });
  } else if (
    request.method === "POST" &&
    target !== null &&
    (days === undefined || (Number.isFinite(days) && days > 0))
  ) {
    moderation.ban(target, days, query.get("note")?.slice(0, 200) ?? undefined, now);
    logger.info("player_banned", { days: days ?? null });
  } else if (request.method === "DELETE" && target !== null) {
    if (!moderation.unban(target, now)) {
      response.send(404, text, "no such ban");
      return;
    }
    logger.info("ban_lifted", {});
  } else if (request.method !== "GET") {
    response.send(400, text, usage);
    return;
  }
  const closed = request.method === "GET" ? 0 : ctx.sessions.closeBanned();
  sendJson(response, { bans: moderation.list(now), closed });
}
