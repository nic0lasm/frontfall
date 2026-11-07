import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { scrubMessage, type ErrorReport } from "@frontfall/protocol";
import { readDocument, writeDocument } from "./database.ts";
import { transaction, type SqlDriver } from "./sql/driver.ts";

/**
 * The errors players' pages report (docs/privacy.md), grouped so that the
 * operator sees which ones come back, how often, since when, in which
 * release and which browser. A group holds the same kind of error with the
 * same scrubbed message from the same place in the code, and counts only:
 * nothing in it tells the players or pages apart.
 */

/** Days of counts a group keeps. */
const KEEP_DAYS = 30;
/** Groups kept at most; past this, the one seen longest ago goes. */
export const MAX_GROUPS = 300;
/** Values counted per field of a group (releases, browsers...); the rest count as `other`. */
const MAX_VALUES = 12;

const Counts = z.record(z.string(), z.number().int().nonnegative());
const Group = z.object({
  type: z.string(),
  message: z.string(),
  where: z.string(),
  first: z.string(),
  last: z.string(),
  days: Counts,
  releases: Counts,
  browsers: Counts,
  devices: Counts,
  screens: Counts,
});
type Group = z.infer<typeof Group>;
const Stored = z.object({ version: z.literal(1), groups: z.record(z.string(), Group) });

/** One group as /admin/errors gives it. */
export interface ErrorGroupView {
  id: string;
  type: string;
  message: string;
  where: string;
  /** Reports in the days asked for. */
  recent: number;
  /** Reports in the 30 days kept. */
  total: number;
  /** First and last day the group was reported (UTC). */
  first: string;
  last: string;
  releases: Record<string, number>;
  browsers: Record<string, number>;
  devices: Record<string, number>;
  screens: Record<string, number>;
}

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Counts one more `value`; past a dozen values, `capped` counts the rarer ones as `other`. */
function add(counts: Record<string, number>, value: string, capped = true): void {
  const known = Object.hasOwn(counts, value);
  const key = known || !capped || Object.keys(counts).length < MAX_VALUES ? value : "other";
  counts[key] = (Object.hasOwn(counts, key) ? (counts[key] ?? 0) : 0) + 1;
}

/** Short id of a group, the same across restarts and servers. */
export function groupId(type: string, message: string, where: string): string {
  return createHash("sha256").update(`${type}\n${message}\n${where}`).digest("hex").slice(0, 12);
}

export class ClientErrors {
  private groups = new Map<string, Group>();

  /** Counts a report into its group; the id of the group. */
  record(report: ErrorReport, now: number): string {
    // Scrubbed again: the page cannot be trusted to have done it.
    const message = report.message ? scrubMessage(report.message) : "";
    const where = report.where ?? "";
    const id = groupId(report.type, message, where);
    const day = dayOf(now);
    let group = this.groups.get(id);
    if (!group) {
      this.prune(now);
      if (this.groups.size >= MAX_GROUPS) this.dropOldest();
      group = {
        type: report.type,
        message,
        where,
        first: day,
        last: day,
        days: {},
        releases: {},
        browsers: {},
        devices: {},
        screens: {},
      };
      this.groups.set(id, group);
    }
    group.last = day;
    // Days are bounded by the 30 kept, and must each be pruned in turn.
    add(group.days, day, false);
    add(group.releases, report.release);
    add(group.browsers, report.browser ?? "unknown");
    add(group.devices, report.device ?? "unknown");
    add(group.screens, report.screen ?? "unknown");
    return id;
  }

  /** The groups reported in the last `days` days, the most reported first. */
  read(now: number, days: number): { days: number; groups: ErrorGroupView[] } {
    this.prune(now);
    const since = dayOf(now - (days - 1) * 24 * 60 * 60 * 1000);
    const groups: ErrorGroupView[] = [];
    for (const [id, group] of this.groups) {
      const recent = Object.entries(group.days)
        .filter(([day]) => day >= since)
        .reduce((a, [, count]) => a + count, 0);
      if (recent === 0) continue;
      const { days: perDay, ...rest } = group;
      groups.push({ id, ...rest, recent, total: sum(perDay) });
    }
    groups.sort((a, b) => b.recent - a.recent || b.last.localeCompare(a.last));
    return { days, groups };
  }

  /** Groups held. */
  get size(): number {
    return this.groups.size;
  }

  serialize(now: number): string {
    this.prune(now);
    return JSON.stringify({ version: 1, groups: Object.fromEntries(this.groups) });
  }

  /** Takes back groups written by serialize(); false when the text is not such groups. */
  restore(text: string): boolean {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }
    const parsed = Stored.safeParse(raw);
    if (!parsed.success) return false;
    this.groups = new Map(Object.entries(parsed.data.groups));
    return true;
  }

  /** Forgets the days past the 30 kept, and the groups left without any. */
  private prune(now: number): void {
    const oldest = dayOf(now - (KEEP_DAYS - 1) * 24 * 60 * 60 * 1000);
    for (const [id, group] of this.groups) {
      group.days = Object.fromEntries(Object.entries(group.days).filter(([day]) => day >= oldest));
      if (Object.keys(group.days).length === 0) this.groups.delete(id);
    }
  }

  private dropOldest(): void {
    let oldest: [string, Group] | undefined;
    for (const entry of this.groups) {
      if (!oldest || entry[1].last < oldest[1].last) oldest = entry;
    }
    if (oldest) this.groups.delete(oldest[0]);
  }
}

/** The file the groups were kept in before data.db, which the first start imports. */
export function clientErrorsFile(dataDir: string): string {
  return join(dataDir, "usage", "errors.json");
}

/** Where the groups are kept in data.db, as one document. */
const ERRORS = "errors";

/** Takes back the groups kept by an earlier run; groups that do not read are kept aside as `errors.broken-<time>`. */
export function loadClientErrors(
  errors: ClientErrors,
  db: SqlDriver,
  now: number,
): Error | undefined {
  const text = readDocument(db, ERRORS);
  if (text === undefined || errors.restore(text)) return undefined;
  const aside = `${ERRORS}.broken-${String(now)}`;
  transaction(db, () => {
    writeDocument(db, aside, text);
    db.run("DELETE FROM documents WHERE name = ?", [ERRORS]);
  });
  return new Error(`unreadable error groups, kept as ${aside}`);
}

/** Writes the groups, replacing the last ones at once. */
export function saveClientErrors(errors: ClientErrors, db: SqlDriver, now: number): void {
  writeDocument(db, ERRORS, errors.serialize(now));
}
