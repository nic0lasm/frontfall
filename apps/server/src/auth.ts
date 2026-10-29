import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Accounts,
  isProvider,
  parseAchievements,
  PROVIDERS,
  type Account,
  type Provider,
  type SignInMethod,
} from "./accounts.ts";
import type { Logger } from "./log.ts";
import { isEmailAddress, mailbox, mailFailure, type Mailer } from "./mail.ts";
import { AddressRate } from "./rate-limit.ts";

/** Where a service sends the player to sign in, and where the server asks who they are. */
export interface ProviderEndpoints {
  authorize: string;
  token: string;
  user: string;
  scope: string;
}

export const ENDPOINTS: Record<Provider, ProviderEndpoints> = {
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    user: "https://discord.com/api/v10/users/@me",
    scope: "identify",
  },
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    user: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
  },
};

export interface AuthOptions {
  /**
   * Address of the game as players reach it, such as https://nclsmgr.com/frontfall:
   * the services send players back under it, and the session cookie is limited to its path.
   */
  publicUrl: string;
  /** Signs the session cookies: another one signs everyone out, and nothing more. */
  sessionSecret: string;
  /** The applications registered with each service. A service left out offers no sign-in. */
  clients: Partial<Record<Provider, { id: string; secret: string }>>;
  /** Other addresses for the services, for tests. */
  endpoints?: Partial<Record<Provider, ProviderEndpoints>>;
  /** Sends sign-in links by email; unset offers no sign-in by email. */
  mail?: {
    mailer: Mailer;
    /** Links sent in a day, all players together: the mailbox's own limit, with room to spare. */
    dailyLimit?: number;
  };
}

export const SESSION_COOKIE = "frontfall_session";
const SIGN_IN_COOKIE = "frontfall_sign_in";
/** A player stays signed in this long after their last sign-in. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Time a player has to sign in at the service before coming back. */
const SIGN_IN_MS = 10 * 60 * 1000;
const SERVICE_TIMEOUT_MS = 10_000;
/** A rename sends a name, a link request an address and a name: a few dozen bytes. */
const MAX_BODY_BYTES = 1024;
/** Achievements of one player: some twenty ids, a level and a day for each. */
const MAX_ACHIEVEMENTS_BYTES = 8192;
/** Time a sign-in link sent by email works for, once. */
export const LINK_MS = 15 * 60 * 1000;
/** Links one address may ask for: three, then one every five minutes. */
const LINK_RATE = { perSecond: 1 / 300, burst: 3 };
/** Links one email address may receive: two, then one every ten minutes. */
const LINK_RATE_PER_EMAIL = { perSecond: 1 / 600, burst: 2 };
const DEFAULT_DAILY_LINKS = 150;
/** Links one address may ask for in a day: well under the daily limit, which one network must not spend alone. */
const LINK_RATE_PER_DAY = { perSecond: 10 / 86_400, burst: 10 };
/** Links waiting to be opened, kept in memory: a restart only makes players ask again. */
const MAX_PENDING_LINKS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Requests to the sign-in routes and /api/me one address may make: a few
 * sign-ins and renames, then one every six seconds. Each sign-in calls the
 * service twice and may write the accounts file.
 */
const AUTH_RATE = { perSecond: 1 / 6, burst: 20 };

/** What `/api/me` tells the page: which buttons to show, and who is signed in. */
export interface Me {
  providers: Provider[];
  /** Whether a link can be sent by email. */
  email: boolean;
  account: {
    name: string;
    provider: SignInMethod;
    /** Every way to sign in to the account, the first one first. */
    methods: SignInMethod[];
    /**
     * A way the player just added that leads to another account of theirs:
     * the two merge once the player says yes to it.
     */
    merge?: { name: string; methods: SignInMethod[] };
  } | null;
}

/** A way to sign in the player added, that leads to another account: held until they say yes. */
interface PendingMerge {
  provider: SignInMethod;
  subject: string;
  /** The account named to the player: another one found there by then is not merged. */
  holderId: string;
  expires: number;
}

/** Time a player has to say yes to a merge. */
const MERGE_MS = 10 * 60 * 1000;
/** The paths of `/api/me` and under it this module answers. */
const ME_PATHS: ReadonlySet<string> = new Set([
  "/api/me",
  "/api/me/achievements",
  "/api/me/merge",
  "/api/me/unlink",
]);

/** A sign-in link sent and not yet opened, known by the hash of its token. */
interface PendingLink {
  /** Hash the account is known by: the address itself is not kept. */
  subject: string;
  /** Name of a new account: the one the player had in the menu. */
  name: string;
  expires: number;
  /** The account the address is added to, when a signed-in player asked for the link. */
  linkTo?: string;
}

/** Words of the email, in the language of the page that asked for it. */
const LINK_MAIL = {
  en: {
    subject: "Your Frontfall sign-in link",
    text: (link: string) =>
      [
        "Hello,",
        "",
        "To sign in to Frontfall, open this link within 15 minutes, then press Finish signing in:",
        "",
        link,
        "",
        "The link works once. If you did not ask for it, you can ignore this email: no account is made without it.",
        "",
        "Frontfall",
      ].join("\n"),
    linkSubject: "Add this address to your Frontfall account",
    linkText: (link: string) =>
      [
        "Hello,",
        "",
        "To add this address to your Frontfall account, open this link within 15 minutes on the device where you are signed in, then press Finish:",
        "",
        link,
        "",
        "The link works once. If you did not ask for it, you can ignore this email: nothing changes without it.",
        "",
        "Frontfall",
      ].join("\n"),
  },
  fr: {
    subject: "Votre lien de connexion à Frontfall",
    text: (link: string) =>
      [
        "Bonjour,",
        "",
        "Pour vous connecter à Frontfall, ouvrez ce lien dans les 15 minutes, puis appuyez sur Terminer la connexion :",
        "",
        link,
        "",
        "Le lien ne sert qu'une fois. Si vous ne l'avez pas demandé, ignorez ce message : aucun compte n'est créé sans lui.",
        "",
        "Frontfall",
      ].join("\n"),
    linkSubject: "Ajoutez cette adresse à votre compte Frontfall",
    linkText: (link: string) =>
      [
        "Bonjour,",
        "",
        "Pour ajouter cette adresse à votre compte Frontfall, ouvrez ce lien dans les 15 minutes sur l'appareil où vous êtes connecté, puis appuyez sur Terminer :",
        "",
        link,
        "",
        "Le lien ne sert qu'une fois. Si vous ne l'avez pas demandé, ignorez ce message : rien ne change sans lui.",
        "",
        "Frontfall",
      ].join("\n"),
  },
} as const;

export interface Auth {
  /** Answers the sign-in routes and `/api/me`; false for any other path. */
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    address: string,
  ): boolean;
  /** The account signed in on this request, from its session cookie. */
  accountOf(request: IncomingMessage): Account | undefined;
  /** Account holding a name, or one that looks like it: guests may not play under it. */
  owner(name: string): Account | undefined;
  readonly accounts: Accounts;
}

/**
 * Sign-in with Discord or Google, done by the server itself with OAuth 2.0
 * and PKCE: the page only follows links. Or with a link sent by email, that
 * works once and for a few minutes. The player gets a signed cookie that
 * the page cannot read, sent with every request and the game socket.
 */
export function createAuth(
  options: AuthOptions,
  accounts: Accounts,
  logger: Logger,
  isAllowedOrigin: (origin: string | undefined) => boolean,
  now: () => number = Date.now,
): Auth {
  const base = new URL(options.publicUrl.replace(/\/*$/, "/"));
  const secure = base.protocol === "https:";
  const cookiePath = base.pathname;
  const providers = PROVIDERS.filter((provider) => options.clients[provider] !== undefined);
  const endpoints = (provider: Provider): ProviderEndpoints =>
    options.endpoints?.[provider] ?? ENDPOINTS[provider];
  const rate = new AddressRate(AUTH_RATE.perSecond, AUTH_RATE.burst, now());
  const redirectUri = (provider: Provider): string =>
    new URL(`auth/${provider}/callback`, base).href;
  const mail = options.mail;
  const linkRate = new AddressRate(LINK_RATE.perSecond, LINK_RATE.burst, now());
  const linkRatePerEmail = new AddressRate(
    LINK_RATE_PER_EMAIL.perSecond,
    LINK_RATE_PER_EMAIL.burst,
    now(),
  );
  const dailyLinksPerAddress = new AddressRate(
    LINK_RATE_PER_DAY.perSecond,
    LINK_RATE_PER_DAY.burst,
    now(),
  );
  const dailyLinks = mail?.dailyLimit ?? DEFAULT_DAILY_LINKS;
  let linksToday = { day: Math.floor(now() / DAY_MS), sent: 0 };
  const pending = new Map<string, PendingLink>();
  /** Merges waiting for the player's yes, by the id of the account signed in. */
  const merges = new Map<string, PendingMerge>();
  const tokenHash = (token: string): string =>
    createHash("sha256").update(token).digest("base64url");

  const sign = (purpose: string, payload: string): string =>
    createHmac("sha256", options.sessionSecret).update(`${purpose}:${payload}`).digest("base64url");
  /** `payload.mac`, or undefined when the mac does not match. */
  const verify = (purpose: string, value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const dot = value.lastIndexOf(".");
    if (dot < 0) return undefined;
    const payload = value.slice(0, dot);
    const given = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(sign(purpose, payload));
    return given.length === expected.length && timingSafeEqual(given, expected)
      ? payload
      : undefined;
  };

  const cookie = (name: string, value: string, maxAgeMs: number, path = cookiePath): string =>
    [
      `${name}=${value}`,
      `Path=${path}`,
      `Max-Age=${String(Math.floor(maxAgeMs / 1000))}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; ");

  function accountOf(request: IncomingMessage): Account | undefined {
    const payload = verify("session", readCookie(request, SESSION_COOKIE));
    if (payload === undefined) return undefined;
    const [id = "", sessions = "", expires = ""] = payload.split(".");
    if (!(Number(expires) > now())) return undefined;
    const account = accounts.get(id);
    return account && String(account.sessions) === sessions ? account : undefined;
  }

  function me(account: Account | undefined): Me {
    if (!account) return { providers, email: mail !== undefined, account: null };
    const held = merges.get(account.id);
    const other = held && held.expires > now() ? accounts.holder(held.subject) : undefined;
    return {
      providers,
      email: mail !== undefined,
      account: {
        name: account.name,
        provider: account.provider,
        methods: accounts.methods(account),
        ...(other &&
          other !== account && {
            merge: { name: other.name, methods: accounts.methods(other) },
          }),
      },
    };
  }

  /**
   * Adds a way to sign in to the account. One that leads to another account
   * is held for the player's yes, and named to them by `me`.
   */
  function addMethod(account: Account, provider: SignInMethod, subject: string): boolean {
    const result = accounts.link(account.id, provider, subject);
    if (result.ok) {
      merges.delete(account.id);
      logger.info("sign_in_added", { provider });
      return true;
    }
    if (result.error !== "other") return false;
    merges.set(account.id, {
      provider,
      subject,
      holderId: result.other.id,
      expires: now() + MERGE_MS,
    });
    return true;
  }

  function session(account: Account): string {
    const value = `${account.id}.${String(account.sessions)}.${String(now() + SESSION_MS)}`;
    return cookie(SESSION_COOKIE, `${value}.${sign("session", value)}`, SESSION_MS);
  }

  /** Back to the menu, with a word for the page when the sign-in did not go through. */
  function home(response: ServerResponse, cookies: string[], failed: boolean): void {
    response
      .writeHead(302, {
        location: failed ? new URL("?signin=failed", base).href : base.href,
        "set-cookie": cookies,
        "cache-control": "no-store",
      })
      .end();
  }

  /**
   * Sends the player to the service. `linkTo`, the id of the account signed
   * in, adds the service to that account instead of signing in with it.
   */
  function start(provider: Provider, response: ServerResponse, linkTo = ""): void {
    const client = options.clients[provider];
    if (!client) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const state = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const payload = `${provider}.${state}.${verifier}.${String(now() + SIGN_IN_MS)}.${linkTo}`;
    const target = new URL(endpoints(provider).authorize);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: client.id,
      redirect_uri: redirectUri(provider),
      scope: endpoints(provider).scope,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: provider === "discord" ? "none" : "select_account",
    }).toString();
    const signInCookie = cookie(
      SIGN_IN_COOKIE,
      `${payload}.${sign("sign-in", payload)}`,
      SIGN_IN_MS,
      `${cookiePath}auth/`,
    );
    // Adding a service is asked by the page itself, which then goes there:
    // the page's policy allows it no form to post.
    if (linkTo !== "") {
      json(response, 200, { location: target.href }, [signInCookie]);
      return;
    }
    response
      .writeHead(302, {
        location: target.href,
        "set-cookie": signInCookie,
        "cache-control": "no-store",
      })
      .end();
  }

  async function finish(
    provider: Provider,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const clear = cookie(SIGN_IN_COOKIE, "", 0, `${cookiePath}auth/`);
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const payload = verify("sign-in", readCookie(request, SIGN_IN_COOKIE));
    const [started = "", state = "", verifier = "", expires = "", linkTo = ""] =
      payload?.split(".") ?? [];
    const client = options.clients[provider];
    // The player said no at the service: back to the menu without a fuss.
    if (query.get("error") === "access_denied") {
      home(response, [clear], false);
      return;
    }
    const code = query.get("code");
    if (
      !client ||
      code === null ||
      started !== provider ||
      query.get("state") !== state ||
      !(Number(expires) > now())
    ) {
      logger.warn("sign_in_failed", { provider, reason: "state" });
      home(response, [clear], true);
      return;
    }
    let found: { id: string; name: string };
    try {
      found = await identify(provider, client, code, verifier);
    } catch (error) {
      logger.warn("sign_in_failed", { provider, reason: (error as Error).message });
      home(response, [clear], true);
      return;
    }
    if (linkTo !== "") {
      // Added only to the account still signed in in this browser, the one that asked.
      const account = accountOf(request);
      const added =
        account?.id === linkTo &&
        addMethod(account, provider, accounts.subject(provider, found.id));
      if (!added) logger.warn("sign_in_failed", { provider, reason: "link" });
      home(response, [clear], !added);
      return;
    }
    const account = accounts.signIn(provider, found.id, found.name, now());
    home(response, [clear, session(account)], false);
  }

  /** Trades the code for a token, then asks the service who the player is. */
  async function identify(
    provider: Provider,
    client: { id: string; secret: string },
    code: string,
    verifier: string,
  ): Promise<{ id: string; name: string }> {
    const { token: tokenUrl, user: userUrl } = endpoints(provider);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(provider),
        client_id: client.id,
        client_secret: client.secret,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) throw new Error(`token ${String(tokenResponse.status)}`);
    const token = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof token.access_token !== "string") throw new Error("token missing");
    const userResponse = await fetch(userUrl, {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!userResponse.ok) throw new Error(`user ${String(userResponse.status)}`);
    const user = (await userResponse.json()) as Record<string, unknown>;
    const id = provider === "discord" ? user.id : user.sub;
    if (typeof id !== "string" || id === "") throw new Error("user id missing");
    const names =
      provider === "discord" ? [user.global_name, user.username] : [user.given_name, user.name];
    return { id, name: names.find((name): name is string => typeof name === "string") ?? "" };
  }

  /**
   * Changes to an account come from the game's own pages only: those of its
   * public address, or of the origin the server is told to accept.
   */
  function sameSite(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    return origin !== undefined && (origin === base.origin || isAllowedOrigin(origin));
  }

  function json(
    response: ServerResponse,
    status: number,
    body: unknown,
    cookies: string[] = [],
  ): void {
    response
      .writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...(cookies.length > 0 && { "set-cookie": cookies }),
      })
      .end(JSON.stringify(body));
  }

  /**
   * The JSON object a request sends, to `use`; a body of another type, too
   * large or not an object is answered here.
   */
  function readJson(
    request: IncomingMessage,
    response: ServerResponse,
    maxBytes: number,
    use: (body: Record<string, unknown>) => void,
  ): void {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      json(response, 415, { error: "invalid", message: "JSON expected" });
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = undefined;
      }
      if (typeof body !== "object" || body === null) {
        json(response, 400, { error: "invalid", message: "a JSON object is expected" });
        return;
      }
      use(body as Record<string, unknown>);
    });
  }

  function rename(account: Account, request: IncomingMessage, response: ServerResponse): void {
    readJson(request, response, MAX_BODY_BYTES, ({ name }) => {
      if (typeof name !== "string") {
        json(response, 400, { error: "invalid", message: "a name is expected" });
        return;
      }
      const result = accounts.rename(account.id, name);
      if (result.ok) json(response, 200, me(account));
      else json(response, result.error === "taken" ? 409 : 400, result);
    });
  }

  /** Keeps what the page sends of the player's achievements, and answers with all of them. */
  function syncAchievements(
    account: Account,
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    readJson(request, response, MAX_ACHIEVEMENTS_BYTES, (body) => {
      const sent = parseAchievements(body);
      if (!sent) {
        json(response, 400, { error: "invalid", message: "achievements expected" });
        return;
      }
      json(response, 200, accounts.mergeAchievements(account.id, sent));
    });
  }

  /**
   * Sends a sign-in link to the address the player typed. The answer is the
   * same whether an account has this address or not, and whether the link
   * was sent or held back for that address: it tells nobody who plays here.
   */
  function sendLink(
    request: IncomingMessage,
    response: ServerResponse,
    address: string,
    mailer: Mailer,
  ): void {
    readJson(request, response, MAX_BODY_BYTES, (body) => {
      const raw = typeof body.email === "string" ? body.email : "";
      const email = raw.normalize("NFC").trim().toLowerCase();
      if (!isEmailAddress(email)) {
        json(response, 400, { error: "invalid", message: "an email address is expected" });
        return;
      }
      const time = now();
      if (!linkRate.take(address, time) || !dailyLinksPerAddress.take(address, time)) {
        json(response, 429, { error: "rate", message: "too many links asked for" });
        return;
      }
      const day = Math.floor(time / DAY_MS);
      if (linksToday.day !== day) linksToday = { day, sent: 0 };
      if (linksToday.sent >= dailyLinks) {
        logger.warn("sign_in_links_held", { reason: "daily limit" });
        json(response, 503, { error: "busy", message: "no more links today" });
        return;
      }
      // Asked by a signed-in player: the address joins their account.
      const linkTo = body.link === true ? accountOf(request) : undefined;
      if (body.link === true && !linkTo) {
        json(response, 401, { error: "signed_out", message: "not signed in" });
        return;
      }
      const subject = accounts.subject("email", email);
      json(response, 202, { sent: true });
      // Held back without a word: saying so would tell that someone asked for this address.
      if (!linkRatePerEmail.take(mailbox(email), time)) return;
      linksToday.sent++;
      for (const [key, link] of pending) {
        if (link.expires <= time || pending.size >= MAX_PENDING_LINKS) pending.delete(key);
        else break;
      }
      const token = randomBytes(32).toString("base64url");
      pending.set(tokenHash(token), {
        subject,
        name: typeof body.name === "string" ? body.name : "",
        expires: time + LINK_MS,
        ...(linkTo && { linkTo: linkTo.id }),
      });
      const link = new URL(base);
      link.hash = `signin=${token}`;
      const words = body.language === "fr" ? LINK_MAIL.fr : LINK_MAIL.en;
      const message = linkTo
        ? { subject: words.linkSubject, text: words.linkText(link.href) }
        : { subject: words.subject, text: words.text(link.href) };
      mailer.send({ to: email, ...message }).then(
        () => {
          logger.info("sign_in_link_sent");
        },
        (error: unknown) => {
          logger.warn("sign_in_link_failed", { reason: mailFailure(error) });
        },
      );
    });
  }

  /** Signs in the player who opened a link: the token works once, before it expires. */
  function confirmLink(request: IncomingMessage, response: ServerResponse): void {
    readJson(request, response, MAX_BODY_BYTES, ({ token }) => {
      const key = typeof token === "string" && token.length <= 64 ? tokenHash(token) : "";
      const link = pending.get(key);
      pending.delete(key);
      if (!link || link.expires <= now()) {
        json(response, 400, { error: "expired", message: "this link is no longer valid" });
        return;
      }
      if (link.linkTo !== undefined) {
        // Finished where the account is signed in, never elsewhere: the
        // address's owner cannot be led to give it to someone else's account.
        const account = accountOf(request);
        if (account?.id !== link.linkTo) {
          json(response, 403, { error: "elsewhere", message: "open the link where you signed in" });
          return;
        }
        if (addMethod(account, "email", link.subject)) json(response, 200, me(account));
        else json(response, 500, { error: "unsaved", message: "the address could not be added" });
        return;
      }
      const account = accounts.signInAs("email", link.subject, link.name, now());
      json(response, 200, me(account), [session(account)]);
    });
  }

  /** Merges the account the player added a way to, or lets it be, as they answer. */
  function answerMerge(account: Account, request: IncomingMessage, response: ServerResponse): void {
    readJson(request, response, MAX_BODY_BYTES, ({ merge }) => {
      const held = merges.get(account.id);
      merges.delete(account.id);
      if (
        merge !== true ||
        !held ||
        held.expires <= now() ||
        accounts.holder(held.subject)?.id !== held.holderId
      ) {
        json(response, 200, me(account));
        return;
      }
      const result = accounts.link(account.id, held.provider, held.subject, true);
      if (!result.ok) {
        json(response, 500, { error: "unsaved", message: "the accounts could not be merged" });
        return;
      }
      if (result.merged)
        logger.info("accounts_merged", {
          account: account.id,
          merged: result.merged.id,
          provider: held.provider,
        });
      json(response, 200, me(account));
    });
  }

  /** Takes a way to sign in off the account, as long as another one is left. */
  function removeMethod(
    account: Account,
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    readJson(request, response, MAX_BODY_BYTES, ({ method }) => {
      if (typeof method !== "string" || (method !== "email" && !isProvider(method))) {
        json(response, 400, { error: "invalid", message: "a way to sign in is expected" });
        return;
      }
      const result = accounts.unlink(account.id, method);
      if (!result.ok) {
        json(
          response,
          result.error === "last" ? 409 : result.error === "unsaved" ? 500 : 400,
          result,
        );
        return;
      }
      logger.info("sign_in_removed", { provider: method });
      json(response, 200, me(account));
    });
  }

  function handle(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    address: string,
  ): boolean {
    if (!ME_PATHS.has(path) && !path.startsWith("/auth/")) return false;
    if (!rate.take(address, now())) {
      response.writeHead(429, { "content-type": "text/plain", "retry-after": "6" }).end();
      return true;
    }
    const method = request.method ?? "GET";
    if (path === "/auth/logout") {
      if (method !== "POST" || !sameSite(request)) {
        response.writeHead(method === "POST" ? 403 : 405, { allow: "POST" }).end();
        return true;
      }
      // Ends the session everywhere, not only in this browser.
      const account = accountOf(request);
      if (account) accounts.signOut(account.id);
      json(response, 200, me(undefined), [cookie(SESSION_COOKIE, "", 0)]);
      return true;
    }
    if (path === "/auth/email" || path === "/auth/email/confirm") {
      if (!mail) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      } else if (method !== "POST" || !sameSite(request)) {
        response.writeHead(method === "POST" ? 403 : 405, { allow: "POST" }).end();
      } else if (path === "/auth/email") {
        sendLink(request, response, address, mail.mailer);
      } else {
        confirmLink(request, response);
      }
      return true;
    }
    if (path === "/api/me/achievements" || path === "/api/me/merge" || path === "/api/me/unlink") {
      if (method !== "POST" || !sameSite(request)) {
        response.writeHead(method === "POST" ? 403 : 405, { allow: "POST" }).end();
        return true;
      }
      const account = accountOf(request);
      if (!account) json(response, 401, { error: "signed_out", message: "not signed in" });
      else if (path === "/api/me/achievements") syncAchievements(account, request, response);
      else if (path === "/api/me/merge") answerMerge(account, request, response);
      else removeMethod(account, request, response);
      return true;
    }
    const signIn = /^\/auth\/([a-z]+)(\/callback|\/link)?$/.exec(path);
    if (signIn) {
      const provider = signIn[1] ?? "";
      if (!isProvider(provider)) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      } else if (signIn[2] === "/link") {
        // A form of the game's page, never a link another site could lead to.
        const account = accountOf(request);
        if (method !== "POST" || !sameSite(request)) {
          response.writeHead(method === "POST" ? 403 : 405, { allow: "POST" }).end();
        } else if (!account) {
          json(response, 401, { error: "signed_out", message: "not signed in" });
        } else {
          start(provider, response, account.id);
        }
      } else if (method !== "GET") {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      } else if (signIn[2]) {
        void finish(provider, request, response);
      } else {
        start(provider, response);
      }
      return true;
    }
    if (path !== "/api/me") return false;
    const account = accountOf(request);
    if (method === "GET" || method === "HEAD") {
      json(response, 200, me(account));
      return true;
    }
    if ((method !== "POST" && method !== "DELETE") || !sameSite(request)) {
      response
        .writeHead(method === "POST" || method === "DELETE" ? 403 : 405, {
          allow: "GET, HEAD, POST, DELETE",
        })
        .end();
      return true;
    }
    if (!account) {
      json(response, 401, { error: "signed_out", message: "not signed in" });
      return true;
    }
    if (method === "POST") {
      rename(account, request, response);
      return true;
    }
    if (!accounts.remove(account.id)) {
      json(response, 500, { error: "unsaved", message: "the account could not be deleted" });
      return true;
    }
    logger.info("account_deleted", { provider: account.provider });
    json(response, 200, me(undefined), [cookie(SESSION_COOKIE, "", 0)]);
    return true;
  }

  return { handle, accountOf, owner: (name) => accounts.owner(name), accounts };
}

/** A cookie of the request, by name; the first one if the browser sent it twice. */
export function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
