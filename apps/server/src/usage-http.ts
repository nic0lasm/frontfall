import { MAX_USAGE_BYTES, parseUsageReport, scrubMessage } from "@frontfall/protocol";
import { groupId } from "./client-errors.ts";
import { systemClock } from "./clock.ts";
import type { Logger } from "./log.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { HttpRequest, HttpResponse } from "./transport.ts";
import type { UsageStats } from "./usage.ts";

/** Reports one address may send at once, then one every 20 s: a game, a vote, a few errors. */
const PER_ADDRESS = { perSecond: 1 / 20, burst: 10 };
/** Reports the whole server takes per second. */
const OVERALL = { perSecond: 50, burst: 100 };
/** Error messages written to the log per hour, at most. */
const LOGGED_ERRORS = { perSecond: 60 / 3600, burst: 60 };
/**
 * Addresses whose buckets are held at once. Past this, reports from a new
 * address are refused until old buckets can be forgotten: a flood from many
 * addresses cannot grow the server's memory.
 */
export const MAX_ADDRESSES = 10_000;
/** An address's bucket is full again after this long and can be forgotten. */
const FORGET_AFTER_MS = (PER_ADDRESS.burst / PER_ADDRESS.perSecond) * 1000;

export interface UsageInbox {
  /** Answers a POST to /api/usage. */
  handle(request: HttpRequest, response: HttpResponse, address: string): void;
}

/**
 * Takes the reports of players' pages into `stats`. The address is only held
 * in memory for the rate limit, never written or logged.
 */
export function usageInbox(
  stats: UsageStats,
  logger: Logger,
  isAllowed: (origin: string | undefined) => boolean,
  now: () => number = () => systemClock.now(),
  maxAddresses = MAX_ADDRESSES,
): UsageInbox {
  const buckets = new Map<string, { bucket: TokenBucket; usedAt: number }>();
  const overall = new TokenBucket(OVERALL.perSecond, OVERALL.burst, now());
  const logged = new TokenBucket(LOGGED_ERRORS.perSecond, LOGGED_ERRORS.burst, now());
  let sweptAt = now();

  const sweep = (at: number): void => {
    sweptAt = at;
    for (const [key, entry] of buckets) {
      if (at - entry.usedAt > FORGET_AFTER_MS) buckets.delete(key);
    }
  };
  const allow = (address: string, at: number): boolean => {
    if (at - sweptAt > FORGET_AFTER_MS) sweep(at);
    let entry = buckets.get(address);
    if (!entry) {
      // Full: forget what can be forgotten, at most once a second, then refuse.
      if (buckets.size >= maxAddresses && at - sweptAt >= 1000) sweep(at);
      if (buckets.size >= maxAddresses) return false;
      entry = {
        bucket: new TokenBucket(PER_ADDRESS.perSecond, PER_ADDRESS.burst, at),
        usedAt: at,
      };
      buckets.set(address, entry);
    }
    entry.usedAt = at;
    return entry.bucket.take(at) && overall.take(at);
  };

  return {
    handle(request, response, address) {
      const end = (status: number): void => {
        response.send(status, { "cache-control": "no-store" });
      };
      if (request.method !== "POST") {
        response.send(405, { allow: "POST" });
        return;
      }
      // Refused before the body is read: the transport drains what is left of it.
      const type = (request.header("content-type") ?? "").split(";")[0]?.trim();
      if (type !== "application/json" && type !== "text/plain") {
        end(415);
        return;
      }
      if (!isAllowed(request.header("origin"))) {
        end(403);
        return;
      }
      if (!allow(address, now())) {
        end(429);
        return;
      }
      void request.body(MAX_USAGE_BYTES).then((body) => {
        if (body.kind === "aborted") return;
        if (body.kind === "too_large") {
          response.send(413, { connection: "close" });
          response.abort();
          return;
        }
        const { bytes } = body;
        const parsed = parseUsageReport(
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8"),
        );
        if (!parsed.ok) {
          end(400);
          return;
        }
        const report = parsed.value;
        stats.record(report, now());
        if (report.kind === "error" && report.message && logged.take(now())) {
          // Scrubbed again here: the page cannot be trusted to have done it.
          const message = scrubMessage(report.message);
          logger.warn("client_error", {
            type: report.type,
            release: report.release,
            message,
            group: groupId(report.type, message, report.where ?? ""),
          });
        }
        end(204);
      });
    },
  };
}
