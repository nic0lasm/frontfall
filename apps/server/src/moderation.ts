import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { join } from "node:path";
import type { ReportReason } from "@frontfall/protocol";
import { network } from "./address.ts";
import { AddressRate } from "./rate-limit.ts";
import { systemClock, type Clock, type Timer } from "./clock.ts";
import { readMeta, writeMeta } from "./database.ts";
import { systemIds, type Ids } from "./ids.ts";
import { transaction, type SqlDriver } from "./sql/driver.ts";

/** Reports older than this are forgotten (R-MODE-06). */
export const REPORT_DAYS = 30;
/** Reports kept at most, the oldest dropped first. */
const MAX_REPORTS = 500;
/** Reports kept about one player, so that a campaign against one fills no more. */
const MAX_REPORTS_PER_TARGET = 20;
/** How long one address counts once against one player, whatever the game. */
const SAME_TARGET_MS = 24 * 60 * 60 * 1000;
/** Reports are written this long after the last one, off the path of the message. */
const SAVE_DELAY_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One report of a player by another, as the operator reads it. */
export interface Report {
  at: string;
  game: string;
  reason: ReportReason;
  /** Reference of the reporter's address. */
  from: string;
  /** Number of the player reported in that game, and the name they played under. */
  player: number;
  name: string;
  /** Reference of the reported player's address; null when the server no longer knew it. */
  target: string | null;
}

/** One entry of the ban list: an address, or the reference of one, until a date or for good. */
export interface Ban {
  target: string;
  until: string | null;
  note?: string;
}

/** What the operator sees of the reports of one player, the most reported first. */
export interface ReportedTarget {
  target: string;
  reports: number;
  /** Different addresses that reported it: one angry player counts once. */
  reporters: number;
  last: string;
  names: string[];
  reasons: Partial<Record<ReportReason, number>>;
  banned: boolean;
}

/** A target the ban list takes: an IP address, or a reference as reports give them. */
export function validTarget(target: string): boolean {
  return (
    isIP(target) !== 0 ||
    /^[A-Za-z0-9_-]{16}$/.test(target) ||
    (target.endsWith("::/64") && isIP(target.slice(0, -3)) === 6)
  );
}

/** A ban target as connections are matched against it: an IPv6 address bans its /64. */
function banTarget(target: string): string {
  if (target.endsWith("/64")) return network(target.slice(0, -3));
  return isIP(target) ? network(plain(target)) : target;
}

/** The usual `::ffff:` form of an IPv4 address seen on an IPv6 socket, as plain IPv4. */
function plain(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/** The files moderation was kept in before data.db, which the first start imports. */
export function moderationFiles(dataDir: string): { key: string; bans: string; reports: string } {
  const directory = join(dataDir, "moderation");
  return {
    key: join(directory, "key"),
    bans: join(directory, "bans.json"),
    reports: join(directory, "reports.json"),
  };
}

/** Where the key of the references is kept, in the `meta` table. */
const KEY = "moderation.key";

/** The key as the file kept it: 64 hex digits. */
export function parseKey(text: string): string | undefined {
  return /^[0-9a-f]{64}\s*$/.test(text) ? text.trim() : undefined;
}

export function writeKey(db: SqlDriver, hex: string): void {
  writeMeta(db, KEY, hex);
}

interface BanRow {
  target: string;
  until: string | null;
  note: string | null;
}

/** The ban list as data.db holds it, checked as the file was. */
export function readBans(db: SqlDriver): Ban[] {
  const rows = db.all<BanRow>("SELECT target, until, note FROM bans ORDER BY rowid");
  return checkBans(
    rows.map(({ target, until, note }) => ({ target, until, ...(note === null ? {} : { note }) })),
    "bans",
  );
}

/** Replaces the ban list, in the transaction of the caller. */
export function writeBans(db: SqlDriver, bans: readonly Ban[]): void {
  db.run("DELETE FROM bans");
  for (const ban of bans) {
    db.run("INSERT INTO bans (target, until, note) VALUES (?, ?, ?)", [
      ban.target,
      ban.until,
      ban.note ?? null,
    ]);
  }
}

interface ReportRow {
  at: string;
  game: string;
  reason: ReportReason;
  reporter: string;
  player: number;
  name: string;
  target: string | null;
}

export function readReports(db: SqlDriver): Report[] {
  return db
    .all<ReportRow>(
      "SELECT at, game, reason, reporter, player, name, target FROM reports ORDER BY seq",
    )
    .map(({ at, game, reason, reporter, player, name, target }) => ({
      at,
      game,
      reason,
      from: reporter,
      player,
      name,
      target,
    }));
}

/** Replaces the reports, in the transaction of the caller. */
export function writeReports(db: SqlDriver, reports: readonly Report[]): void {
  db.run("DELETE FROM reports");
  for (const r of reports) {
    db.run(
      "INSERT INTO reports (at, game, reason, reporter, player, name, target) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [r.at, r.game, r.reason, r.from, r.player, r.name, r.target],
    );
  }
}

/**
 * Reports of players and the operator's ban list (R-MODE-06). An address is
 * never written down: reports name it by a reference, a keyed hash that stays
 * the same across restarts when the server has a data directory, and that the
 * operator can ban without ever seeing the address.
 */
export class Moderation {
  private readonly key: Buffer;
  private reports: Report[] = [];
  private bans: Ban[] = [];
  private readonly rate: AddressRate;
  private saveTimer: Timer | undefined;

  /**
   * @param db where the key, the reports and the ban list are kept; undefined
   * keeps them in memory, with references that change at each start. The ban
   * list is read by `reload`, which says when it does not read.
   * @param clock the time, and the timer of the next write of the reports.
   * @param ids where a new key is drawn.
   */
  constructor(
    private readonly db: SqlDriver | undefined,
    now: number,
    rate = { perSecond: 1 / 120, burst: 5 },
    private readonly clock: Clock = systemClock,
    private readonly ids: Ids = systemIds,
  ) {
    this.rate = new AddressRate(rate.perSecond, rate.burst, now);
    this.key = this.loadKey();
    if (db !== undefined) this.reports = readReports(db);
  }

  /** The reference of an address, as reports give it and the ban list takes it. */
  ref(address: string): string {
    return createHmac("sha256", this.key).update(plain(address)).digest("base64url").slice(0, 16);
  }

  /** The ban that turns this address away at `now`, if any. */
  banned(address: string, now: number): Ban | undefined {
    const ip = plain(address);
    const ref = this.ref(address);
    return this.bans.find(
      (ban) =>
        (ban.target === ip || ban.target === ref) &&
        (ban.until === null || Date.parse(ban.until) > now),
    );
  }

  /**
   * Records a report, once per reporter, game and player, and once a day
   * per reporter and reported address. False when the reporter's address
   * has sent too many lately.
   */
  report(
    report: Omit<Report, "at" | "from" | "target">,
    from: string,
    target: string | undefined,
    now: number,
  ): boolean {
    const fromRef = this.ref(from);
    const targetRef = target === undefined ? null : this.ref(target);
    const twice = this.reports.some(
      (r) =>
        r.from === fromRef &&
        ((r.game === report.game && r.player === report.player) ||
          (targetRef !== null &&
            r.target === targetRef &&
            now - Date.parse(r.at) < SAME_TARGET_MS)),
    );
    if (twice) return true;
    if (!this.rate.take(from, now)) return false;
    this.reports.push({
      at: new Date(now).toISOString(),
      ...report,
      from: fromRef,
      target: targetRef,
    });
    if (targetRef !== null) {
      const about = this.reports.filter((r) => r.target === targetRef);
      if (about.length > MAX_REPORTS_PER_TARGET) {
        const oldest = about[0];
        this.reports = this.reports.filter((r) => r !== oldest);
      }
    }
    this.prune(now);
    this.saveReportsSoon();
    return true;
  }

  /** Reports of the last `days`, newest first, and the players they name, the most reported first. */
  read(now: number, days = REPORT_DAYS): { reports: Report[]; targets: ReportedTarget[] } {
    this.prune(now);
    const since = now - days * DAY_MS;
    const reports = this.reports.filter((r) => Date.parse(r.at) >= since).reverse();
    const banned = new Set(this.list(now).map((ban) => ban.target));
    const byTarget = new Map<string, ReportedTarget>();
    const reporters = new Map<string, Set<string>>();
    for (const r of reports) {
      if (r.target === null) continue;
      let entry = byTarget.get(r.target);
      if (!entry) {
        entry = {
          target: r.target,
          reports: 0,
          reporters: 0,
          last: r.at,
          names: [],
          reasons: {},
          banned: banned.has(r.target),
        };
        byTarget.set(r.target, entry);
      }
      const from = reporters.get(r.target) ?? new Set();
      reporters.set(r.target, from.add(r.from));
      entry.reports++;
      entry.reporters = from.size;
      entry.reasons[r.reason] = (entry.reasons[r.reason] ?? 0) + 1;
      if (!entry.names.includes(r.name)) entry.names.push(r.name);
    }
    const targets = [...byTarget.values()].sort(
      (a, b) => b.reporters - a.reporters || b.reports - a.reports,
    );
    return { reports, targets };
  }

  /** The ban list, expired entries left out. */
  list(now: number): Ban[] {
    return this.bans.filter((ban) => ban.until === null || Date.parse(ban.until) > now);
  }

  /**
   * Bans `target` for `days`, or for good when `days` is undefined; replaces
   * an earlier ban of it. The list is read again first, in the same
   * transaction, so that a ban the admin command added meanwhile stays.
   */
  ban(given: string, days: number | undefined, note: string | undefined, now: number): Ban {
    const target = banTarget(given);
    const ban: Ban = {
      target,
      until: days === undefined ? null : new Date(now + days * DAY_MS).toISOString(),
      ...(note ? { note } : {}),
    };
    this.changeBans(now, (bans) => [...bans.filter((other) => other.target !== target), ban]);
    return ban;
  }

  /** Lifts the ban of `target`; false when there was none. */
  unban(given: string, now: number): boolean {
    const target = banTarget(given);
    let found = false;
    this.changeBans(now, (bans) => {
      const kept = bans.filter((ban) => ban.target !== target);
      found = kept.length !== bans.length;
      return kept;
    });
    return found;
  }

  /**
   * Reads the ban list again, after the admin command changed it. A list
   * that does not read leaves the one in memory as it was, and throws.
   */
  reload(now = this.clock.now()): void {
    if (this.db === undefined) return;
    // Bans that ran out are dropped, and leave data.db at its next write.
    this.bans = readBans(this.db).filter(
      (ban) => ban.until === null || Date.parse(ban.until) > now,
    );
  }

  /** Writes the reports not yet written, as the server stops. */
  flush(): void {
    if (this.saveTimer === undefined) return;
    this.saveTimer.clear();
    this.saveTimer = undefined;
    this.saveReports();
  }

  /** Applies `change` to the ban list, as data.db holds it when there is one, and keeps the result. */
  private changeBans(now: number, change: (bans: Ban[]) => Ban[]): void {
    const db = this.db;
    const live = (bans: Ban[]): Ban[] =>
      bans.filter((ban) => ban.until === null || Date.parse(ban.until) > now);
    if (db === undefined) {
      this.bans = change(live(this.bans));
      return;
    }
    this.bans = transaction(db, () => {
      const bans = change(live(readBans(db)));
      writeBans(db, bans);
      return bans;
    });
  }

  private saveReports(): void {
    const db = this.db;
    if (db === undefined) return;
    transaction(db, () => {
      writeReports(db, this.reports);
    });
  }

  private saveReportsSoon(): void {
    if (this.db === undefined || this.saveTimer !== undefined) return;
    this.saveTimer = this.clock.setTimeout(() => {
      this.saveTimer = undefined;
      try {
        this.saveReports();
      } catch {
        // Tried again with the next report, or at the stop.
      }
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  private prune(now: number): void {
    const since = now - REPORT_DAYS * DAY_MS;
    this.reports = this.reports.filter((r) => Date.parse(r.at) >= since).slice(-MAX_REPORTS);
  }

  private loadKey(): Buffer {
    if (this.db === undefined) return this.ids.bytes(32);
    const kept = parseKey(readMeta(this.db, KEY) ?? "");
    if (kept !== undefined) return Buffer.from(kept, "hex");
    const key = this.ids.bytes(32);
    writeKey(this.db, key.toString("hex"));
    return key;
  }
}

/** Reads a bans.json of the earlier releases; throws, naming the entry, when it does not read. */
export function parseBans(text: string): Ban[] {
  const json = JSON.parse(text) as { bans?: unknown };
  if (!Array.isArray(json.bans)) throw new Error('bans.json: expected { "bans": [...] }');
  return oneEach(checkBans(json.bans, "bans.json"));
}

/** Whether a ban ends after another, or at the same time: one with no end lasts longest. */
function lastsAsLong(ban: Ban, other: Ban): boolean {
  if (ban.until === null) return true;
  return other.until !== null && Date.parse(ban.until) >= Date.parse(other.until);
}

/**
 * One ban a target. A file edited by hand can give one target twice, as an
 * IPv4 address and its `::ffff:` form, or two addresses of one IPv6 /64.
 * The earlier releases banned it while any of them ran, so the one that
 * lasts longest is kept, the later one when they end together.
 */
function oneEach(bans: readonly Ban[]): Ban[] {
  const kept = new Map<string, Ban>();
  for (const ban of bans) {
    const other = kept.get(ban.target);
    if (other === undefined || lastsAsLong(ban, other)) kept.set(ban.target, ban);
  }
  return [...kept.values()];
}

/** Bans as given, each checked; throws, naming the entry, at the first that is wrong. */
function checkBans(entries: readonly unknown[], source: string): Ban[] {
  return entries.map((entry: unknown, index) => {
    const { target, until, note } = (entry ?? {}) as Record<string, unknown>;
    const at = `${source}, entry ${String(index + 1)}`;
    if (typeof target !== "string" || !validTarget(target))
      throw new Error(`${at}: target must be an IP address or a 16-character reference`);
    if (
      until !== undefined &&
      until !== null &&
      (typeof until !== "string" || Number.isNaN(Date.parse(until)))
    )
      throw new Error(`${at}: until must be a date, such as 2026-12-01, or null`);
    if (note !== undefined && typeof note !== "string") throw new Error(`${at}: note must be text`);
    return {
      target: banTarget(target),
      until: typeof until === "string" ? new Date(until).toISOString() : null,
      ...(note ? { note } : {}),
    };
  });
}

/** Reads a reports.json of the earlier releases; undefined when it is not one. */
export function parseReports(text: string): Report[] | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const reports = (json as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(reports) || !reports.every(isReport)) return undefined;
  return reports;
}

function isReport(value: unknown): value is Report {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.at === "string" &&
    typeof r.game === "string" &&
    typeof r.reason === "string" &&
    typeof r.from === "string" &&
    typeof r.player === "number" &&
    typeof r.name === "string" &&
    (typeof r.target === "string" || r.target === null)
  );
}
