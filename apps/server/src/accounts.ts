import { createHmac } from "node:crypto";
import { join } from "node:path";
import { nameKey as foldName, MAX_NAME_LENGTH, normalizeName } from "@frontfall/protocol";
import { systemClock, type Clock } from "./clock.ts";
import { readDocument, readMeta, writeDocument, writeMeta } from "./database.ts";
import { systemIds, type Ids } from "./ids.ts";
import { transaction, type SqlDriver } from "./sql/driver.ts";

/** Services a player may sign in with. */
export const PROVIDERS = ["discord", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** How a player signed in: at a service, or with a link sent to their email address. */
export type SignInMethod = Provider | "email";

function isSignInMethod(value: string): value is SignInMethod {
  return value === "email" || isProvider(value);
}

/**
 * Achievements of an account, as the page counts them: the level and first
 * day of each one earned, and the counts behind the tiers. Kept so that they
 * follow the player from one device to another.
 */
export interface AccountAchievements {
  earned: Record<string, { at: number; level: number }>;
  counts: Record<string, number>;
}

/** An achievement id or a count's name, as the page writes them. */
const ACHIEVEMENT_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_ACHIEVEMENTS = 64;
const MAX_COUNTERS = 8;
const MAX_LEVEL = 3;
const MAX_COUNT = 1_000_000_000;

/**
 * A player who signed in. The server knows them by a keyed hash of the id
 * the service gave them, or of their email address, and keeps nothing else:
 * no address, no picture, no name but the one they play under.
 */
export interface Account {
  readonly id: string;
  /** The first way the player signed in, or the first one left after they took others off. */
  provider: SignInMethod;
  /**
   * HMAC of the service's id or of the email address, keyed by the file's
   * salt: the file alone does not tell who it is.
   */
  subject: string;
  /** Other ways the player added to sign in to the same account, hashed as `subject`. */
  links?: SignInLink[];
  /**
   * Ids of the accounts merged into this one: the operator's list may name
   * any of them.
   */
  mergedIds?: string[];
  /** The name the player plays under, reserved for them. */
  name: string;
  createdAt: number;
  /** Last sign-in, by the day: an account unused for years can be told apart. */
  seenAt: number;
  /** Raised on every sign-out: the session cookies made before it no longer count. */
  sessions: number;
  /** Achievements the page has sent, once it has. */
  achievements?: AccountAchievements;
}

/** One more way to sign in to an account. */
export interface SignInLink {
  provider: SignInMethod;
  subject: string;
}

export type LinkResult =
  | { ok: true; merged: Account | undefined }
  | { ok: false; error: "invalid" | "unsaved"; message: string }
  /** The way leads to another account, and merging was not asked for. */
  | { ok: false; error: "other"; other: Account; message: string };

export type UnlinkResult =
  { ok: true } | { ok: false; error: "invalid" | "last" | "unsaved"; message: string };

/** Ways to sign in one account may hold: each service and an address, a few times over after merges. */
const MAX_LINKS = 8;

export type RenameResult =
  { ok: true; name: string } | { ok: false; error: "invalid" | "taken"; message: string };

const FILE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two names that look alike to players are the same name: case, accents,
 * spaces, punctuation and look-alike letters of other scripts do not tell
 * them apart. Kept in memory only: the keys are rebuilt from the names on
 * every load, so a change of the folding needs no change of the file.
 */
export function nameKey(name: string): string {
  return foldName(name);
}

/** The file accounts were kept in before data.db, which the first start imports. */
export function accountsFile(dataDir: string): string {
  return join(dataDir, "accounts", "accounts.json");
}

/** Where the salt is kept, in the `meta` table. */
const SALT_KEY = "accounts.salt";
/** The accounts as they were before the first merge, in the `documents` table. */
export const BEFORE_MERGES = "accounts.before-merges";

/** The accounts and their salt, as the file kept them before data.db. */
export interface AccountsFile {
  salt: string;
  accounts: Account[];
}

/** Reads an accounts file of the earlier releases; undefined when it is not one. */
export function parseAccountsFile(text: string): AccountsFile | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== FILE_VERSION ||
    typeof parsed.salt !== "string" ||
    parsed.salt.length < 32 ||
    !Array.isArray(parsed.accounts)
  )
    return undefined;
  const accounts = parsed.accounts.filter(isAccount);
  if (accounts.length !== parsed.accounts.length) return undefined;
  return { salt: parsed.salt, accounts };
}

/** Writes accounts read from a file into data.db, with their salt, in the transaction of the caller. */
export function writeAccounts(db: SqlDriver, file: AccountsFile): void {
  writeMeta(db, SALT_KEY, file.salt);
  for (const account of file.accounts) {
    db.run(
      "INSERT INTO accounts (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body",
      [account.id, JSON.stringify(account)],
    );
  }
}

/**
 * The accounts, all in memory, each one written to data.db as it changes.
 * Sign-ups and renames are rare next to games.
 */
export class Accounts {
  private readonly byId = new Map<string, Account>();
  private readonly bySubject = new Map<string, Account>();
  private readonly byName = new Map<string, Account>();
  /**
   * Key the services' ids are hashed with, drawn once when the file is
   * created and kept in it: the accounts depend on no setting of the server.
   */
  private salt: string;
  /** Ids of the accounts whose last write failed: they are written again with the next change. */
  private readonly unsaved = new Set<string>();

  /**
   * @param db where the accounts are kept; unset keeps them in memory only, for tests.
   * @param onWriteError told when the database could not be written, as on a full disk.
   * @param ports where the salt, the account ids and the digits of free names are drawn, and the time.
   */
  constructor(
    private readonly db: SqlDriver | undefined,
    private readonly onWriteError: (error: Error) => void = () => undefined,
    private readonly ports: { clock: Clock; ids: Ids } = { clock: systemClock, ids: systemIds },
  ) {
    this.salt = ports.ids.bytes(32).toString("base64url");
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * Reads the accounts; an empty database is a first start, which keeps a new
   * salt. Accounts that cannot be read, as with a database that does not open
   * or a row that is not an account, are an error the accounts cannot start
   * with: a later write could replace them.
   */
  load(): { error?: Error; usable: boolean } {
    const db = this.db;
    if (db === undefined) return { usable: true };
    let salt: string | undefined;
    let rows: { body: string }[];
    try {
      salt = readMeta(db, SALT_KEY);
      rows = db.all<{ body: string }>("SELECT body FROM accounts ORDER BY rowid");
      if (salt === undefined) {
        if (rows.length > 0)
          return { error: new Error("accounts without their salt"), usable: false };
        writeMeta(db, SALT_KEY, this.salt);
        return { usable: true };
      }
    } catch (error) {
      return { error: error as Error, usable: false };
    }
    const accounts: Account[] = [];
    for (const { body } of rows) {
      let account: unknown;
      try {
        account = JSON.parse(body);
      } catch {
        account = undefined;
      }
      if (!isAccount(account))
        return { error: new Error("an account row does not read"), usable: false };
      accounts.push(account);
    }
    this.salt = salt;
    for (const account of accounts) this.add(account);
    return { usable: true };
  }

  get(id: string): Account | undefined {
    return this.byId.get(id);
  }

  /** The account a hashed way to sign in leads to. */
  holder(subject: string): Account | undefined {
    return this.bySubject.get(subject);
  }

  /** The account holding this name, or one that looks like it. */
  owner(name: string): Account | undefined {
    return this.byName.get(nameKey(name));
  }

  /**
   * The account of this player at this service, made on their first sign-in
   * under the name they have there, cleaned, or another free one.
   */
  signIn(provider: SignInMethod, providerId: string, suggested: string, now: number): Account {
    return this.signInAs(provider, this.subject(provider, providerId), suggested, now);
  }

  /** As `signIn`, for a subject already hashed with `subject`. */
  signInAs(provider: SignInMethod, subject: string, suggested: string, now: number): Account {
    const found = this.bySubject.get(subject);
    if (found) {
      // Written at most once a day, not at every sign-in.
      if (now - found.seenAt >= DAY_MS) {
        found.seenAt = dayOf(now);
        this.save([found]);
      }
      return found;
    }
    const account: Account = {
      id: this.ports.ids.bytes(12).toString("base64url"),
      provider,
      subject,
      name: this.freeName(suggested),
      createdAt: dayOf(now),
      seenAt: dayOf(now),
      sessions: 0,
    };
    this.add(account);
    this.save([account]);
    return account;
  }

  rename(id: string, raw: string): RenameResult {
    const account = this.byId.get(id);
    const checked = normalizeName(raw);
    if (!account) return { ok: false, error: "invalid", message: "no such account" };
    if (!checked.ok) return { ok: false, error: "invalid", message: checked.error };
    const holder = this.owner(checked.name);
    if (holder && holder !== account)
      return { ok: false, error: "taken", message: "this name belongs to another account" };
    this.byName.delete(nameKey(account.name));
    account.name = checked.name;
    this.byName.set(nameKey(account.name), account);
    this.save([account]);
    return { ok: true, name: account.name };
  }

  /** Ends every session of the account, on every device. */
  signOut(id: string): void {
    const account = this.byId.get(id);
    if (!account) return;
    account.sessions++;
    this.save([account]);
  }

  /**
   * Deletes an account at its owner's request: nothing of it is left in the
   * file. False when there is no such account, or the file could not be written.
   */
  remove(id: string): boolean {
    const account = this.byId.get(id);
    if (!account) return false;
    this.drop(account);
    // A deletion that never reached the database would bring the account back
    // at the next start: the player is told it failed, and the account stays.
    if (this.save([], [account.id])) return true;
    this.add(account);
    return false;
  }

  /** The ways to sign in to an account, each once, the first one first. */
  methods(account: Account): SignInMethod[] {
    return [...new Set([account.provider, ...(account.links ?? []).map((link) => link.provider)])];
  }

  /** The account's id and those of the accounts merged into it. */
  knownIds(id: string): string[] {
    const account = this.byId.get(id);
    return account ? [account.id, ...(account.mergedIds ?? [])] : [id];
  }

  /**
   * Adds a way to sign in to an account, for a subject already hashed with
   * `subject`. The player proved they hold both: the account they are signed
   * in to, and the service or address they just went through. When that way
   * already leads to another account, the other one joins this one: its
   * achievements and ways to sign in come along, its name is freed, and
   * this account keeps its own name. That happens only once the player said
   * yes to it, `merge`; before, the other account is named in the answer.
   */
  link(id: string, provider: SignInMethod, subject: string, merge = false): LinkResult {
    const account = this.byId.get(id);
    if (!account) return { ok: false, error: "invalid", message: "no such account" };
    const holder = this.bySubject.get(subject);
    if (holder === account) return { ok: true, merged: undefined };
    if (holder && !merge)
      return { ok: false, error: "other", other: holder, message: "this leads to another account" };
    const before = structuredClone(account);
    const added: SignInLink[] = holder
      ? [{ provider: holder.provider, subject: holder.subject }, ...(holder.links ?? [])]
      : [{ provider, subject }];
    if ((account.links?.length ?? 0) + added.length > MAX_LINKS - 1)
      return { ok: false, error: "invalid", message: "too many ways to sign in" };
    if (holder) {
      this.drop(holder);
      account.mergedIds = [...(account.mergedIds ?? []), holder.id, ...(holder.mergedIds ?? [])];
      account.createdAt = Math.min(account.createdAt, holder.createdAt);
      account.seenAt = Math.max(account.seenAt, holder.seenAt);
      if (holder.achievements) mergeInto(account, holder.achievements);
    }
    account.links = [...(account.links ?? []), ...added];
    for (const link of added) this.bySubject.set(link.subject, account);
    if (holder) this.keepCopy(before, holder);
    if (this.save([account], holder ? [holder.id] : [])) return { ok: true, merged: holder };
    // Left as it was: a merge only half written would bring both accounts back.
    this.drop(account);
    this.add(before);
    if (holder) this.add(holder);
    return { ok: false, error: "unsaved", message: "the accounts could not be saved" };
  }

  /** Takes a way to sign in off an account, as long as another one is left. */
  unlink(id: string, provider: SignInMethod): UnlinkResult {
    const account = this.byId.get(id);
    if (!account) return { ok: false, error: "invalid", message: "no such account" };
    const all: SignInLink[] = [
      { provider: account.provider, subject: account.subject },
      ...(account.links ?? []),
    ];
    const kept = all.filter((link) => link.provider !== provider);
    if (kept.length === all.length)
      return { ok: false, error: "invalid", message: "this way to sign in is not on the account" };
    const [first] = kept;
    if (!first) return { ok: false, error: "last", message: "the last way to sign in stays" };
    const before = structuredClone(account);
    for (const link of all) if (link.provider === provider) this.bySubject.delete(link.subject);
    account.provider = first.provider;
    account.subject = first.subject;
    account.links = kept.slice(1);
    if (account.links.length === 0) delete account.links;
    if (this.save([account])) return { ok: true };
    // A way taken off only in memory would come back at the next start.
    this.drop(account);
    this.add(before);
    return { ok: false, error: "unsaved", message: "the accounts could not be saved" };
  }

  /**
   * Adds what the page sends to the achievements of the account, and returns
   * them all. Nothing is ever taken away: a level only rises, a first day
   * only moves earlier, a count only grows. Two devices played apart between
   * two syncs keep the larger count of the two, not their sum.
   */
  mergeAchievements(id: string, sent: AccountAchievements): AccountAchievements | undefined {
    const account = this.byId.get(id);
    if (!account) return undefined;
    const changed = mergeInto(account, sent);
    if (changed) this.save([account]);
    return account.achievements;
  }

  /** The hash an account of this method and id is known by. */
  subject(provider: SignInMethod, providerId: string): string {
    return createHmac("sha256", this.salt)
      .update(`account:${provider}:${providerId}`)
      .digest("base64url");
  }

  /** The suggested name if it is allowed and free, else a free one close to it. */
  private freeName(suggested: string): string {
    const checked = normalizeName(cleanSuggestion(suggested));
    const base = checked.ok ? checked.name : "Player";
    if (!this.owner(base)) return base;
    for (let attempt = 0; ; attempt++) {
      // Four digits, then more as the short ones run out.
      const digits = String(
        1000 + Math.floor(this.ports.ids.fraction() * 9000 * 10 ** Math.floor(attempt / 50)),
      );
      const name = `${Array.from(base)
        .slice(0, MAX_NAME_LENGTH - digits.length)
        .join("")
        .trimEnd()}${digits}`;
      if (normalizeName(name).ok && !this.owner(name)) return name;
    }
  }

  /**
   * Keeps the accounts as they were before the first merge the server ever
   * makes, so that the operator can go back if merges turn out wrong. Kept
   * once: later merges leave the copy as it was. `account` and `holder` are
   * the two accounts as they were before this merge.
   */
  private keepCopy(account: Account, holder: Account): void {
    const db = this.db;
    if (db === undefined) return;
    try {
      if (readDocument(db, BEFORE_MERGES) !== undefined) return;
      const others = [...this.byId.values()].filter((one) => one.id !== account.id);
      const body = JSON.stringify({
        version: FILE_VERSION,
        salt: this.salt,
        accounts: [...others, account, holder],
      });
      writeDocument(db, BEFORE_MERGES, body);
    } catch {
      // Not kept: the merge goes on, as when the copy could not be made before.
    }
  }

  private add(account: Account): void {
    this.byId.set(account.id, account);
    this.bySubject.set(account.subject, account);
    for (const link of account.links ?? []) this.bySubject.set(link.subject, account);
    this.byName.set(nameKey(account.name), account);
  }

  private drop(account: Account): void {
    this.byId.delete(account.id);
    this.bySubject.delete(account.subject);
    for (const link of account.links ?? []) this.bySubject.delete(link.subject);
    this.byName.delete(nameKey(account.name));
  }

  /**
   * Writes the accounts that changed and deletes those that went, in one
   * transaction, so that a crash never leaves half a change. A write that
   * fails, as on a full disk, must not stop the server: the accounts stay
   * right in memory and the caller decides what to undo. What it does not
   * undo, as a new account or a rename, is written again with the next
   * change, so that it is not lost at the next restart.
   */
  private save(changed: readonly Account[], removed: readonly string[] = []): boolean {
    const db = this.db;
    if (db === undefined) return true;
    const given = new Set([...changed.map(({ id }) => id), ...removed]);
    const retried = [...this.unsaved]
      .filter((id) => !given.has(id))
      .map((id) => this.byId.get(id))
      .filter((account) => account !== undefined);
    const written = [...changed, ...retried];
    try {
      transaction(db, () => {
        // The salt goes with the first account, as it went with the first file.
        writeMeta(db, SALT_KEY, this.salt);
        for (const id of removed) db.run("DELETE FROM accounts WHERE id = ?", [id]);
        for (const account of written) {
          db.run(
            "INSERT INTO accounts (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body",
            [account.id, JSON.stringify(account)],
          );
        }
      });
      this.unsaved.clear();
      return true;
    } catch (error) {
      for (const { id } of written) this.unsaved.add(id);
      this.onWriteError(error as Error);
      return false;
    }
  }
}

/** Keeps the characters a player name allows, so that "x_Bob_x" becomes "xBobx", not "Player". */
function cleanSuggestion(raw: string): string {
  return Array.from(
    raw
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, "")
      .replace(/^[^\p{L}\p{M}\p{N}]+/u, "")
      .trim(),
  )
    .slice(0, MAX_NAME_LENGTH)
    .join("")
    .trimEnd();
}

/** Adds achievements to an account's, as `mergeAchievements` tells; true when any changed. */
function mergeInto(account: Account, sent: AccountAchievements): boolean {
  const kept: AccountAchievements = account.achievements ?? { earned: {}, counts: {} };
  let changed = account.achievements === undefined;
  for (const [key, { at, level }] of Object.entries(sent.earned)) {
    const before = Object.hasOwn(kept.earned, key) ? kept.earned[key] : undefined;
    if (!before && Object.keys(kept.earned).length >= MAX_ACHIEVEMENTS) continue;
    const merged = before
      ? { at: Math.min(before.at, at), level: Math.max(before.level, level) }
      : { at, level };
    if (!before || merged.at !== before.at || merged.level !== before.level) {
      kept.earned[key] = merged;
      changed = true;
    }
  }
  for (const [key, count] of Object.entries(sent.counts)) {
    const before = Object.hasOwn(kept.counts, key) ? kept.counts[key] : undefined;
    if (before === undefined && Object.keys(kept.counts).length >= MAX_COUNTERS) continue;
    if (before === undefined || count > before) {
      kept.counts[key] = count;
      changed = true;
    }
  }
  account.achievements = kept;
  return changed;
}

function dayOf(time: number): number {
  return time - (time % DAY_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isAccount(value: unknown): value is Account {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    isSignInMethod(value.provider) &&
    typeof value.subject === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.seenAt === "number" &&
    Number.isInteger(value.sessions) &&
    (value.links === undefined ||
      (Array.isArray(value.links) &&
        value.links.every(
          (link) =>
            isRecord(link) &&
            typeof link.provider === "string" &&
            isSignInMethod(link.provider) &&
            typeof link.subject === "string",
        ))) &&
    (value.mergedIds === undefined ||
      (Array.isArray(value.mergedIds) && value.mergedIds.every((id) => typeof id === "string"))) &&
    (value.achievements === undefined || parseAchievements(value.achievements) !== undefined)
  );
}

/**
 * Achievements as the page sends them, checked: known shapes and sizes only,
 * so that an account's share of the file stays small. Undefined when they
 * are not achievements at all.
 */
export function parseAchievements(value: unknown): AccountAchievements | undefined {
  if (!isRecord(value) || !isPlainRecord(value.earned) || !isPlainRecord(value.counts))
    return undefined;
  const earned: AccountAchievements["earned"] = {};
  const counts: AccountAchievements["counts"] = {};
  const earnedEntries = Object.entries(value.earned);
  const countEntries = Object.entries(value.counts);
  if (earnedEntries.length > MAX_ACHIEVEMENTS || countEntries.length > MAX_COUNTERS)
    return undefined;
  for (const [key, entry] of earnedEntries) {
    if (!ACHIEVEMENT_KEY.test(key) || !isPlainRecord(entry)) return undefined;
    const { at, level } = entry;
    if (
      typeof at !== "number" ||
      !Number.isFinite(at) ||
      at < 0 ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > MAX_LEVEL
    )
      return undefined;
    earned[key] = { at, level };
  }
  for (const [key, count] of countEntries) {
    if (
      !ACHIEVEMENT_KEY.test(key) ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_COUNT
    )
      return undefined;
    counts[key] = count;
  }
  return { earned, counts };
}
