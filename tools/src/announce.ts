import { PublicGame } from "@frontfall/protocol";
import { z } from "zod";

// Announces on a Discord webhook the public games that /api/games lists as
// open, and those that ended. A running game that leaves the list ended, unless
// the server restarted meanwhile, which /api/status tells by its startedAt.
// No winner is named: the server never learns who won, it only relays turns.

/** What `/api/games` answers; see docs/protocol.md, "HTTP endpoints". */
export const GameList = z.object({ games: z.array(PublicGame) });
/** The part of `/api/status` read here; see docs/server.md. */
export const Status = z.object({ state: z.string(), startedAt: z.string() });

/** Games `/api/games` lists at most (MAX_LISTED_GAMES in apps/server/src/directory.ts, a test ties the two). */
export const MAX_LISTED = 100;

/** How long a game's id is remembered after it was last listed, so it is never announced twice. */
const REMEMBER_MS = 24 * 60 * 60 * 1000;
/** Posts kept while the webhook refuses them; older ones are dropped. */
const MAX_PENDING = 20;
/** Any request taking longer is given up, so that one stuck answer does not stop the rounds. */
const TIMEOUT_MS = 10_000;

/** A Discord webhook message that mentions nobody, whatever the names hold. */
export interface Post {
  content: string;
  allowed_mentions: { parse: [] };
}

/** Names come from players and from the server polled: no Discord formatting gets through. */
export function escapeMarkdown(text: string): string {
  return text.slice(0, 100).replace(/[\\*_~`|>#[\]()<:@-]/g, "\\$&");
}

export class Announcer {
  /** Ids of the games listed, and when each was last listed; undefined until a list was read. */
  private seen: Map<string, number> | undefined;
  /** Announcements not posted yet. An opening is keyed by its game's id, an end by `end:` and the id. */
  private pending = new Map<string, Post>();
  /** The running games of the last lists, each with the post that will announce its end. */
  private running = new Map<string, Post>();
  /** The `startedAt` of the server run those games belong to. */
  private run: string | undefined;

  /** @param joinUrl The page that joins a game, given its id. */
  constructor(private readonly joinUrl: (id: string) => string) {}

  /**
   * Takes one list of public games and returns what to post: the games newly
   * open or ended, after those the webhook refused before.
   *
   * @param run The server's `startedAt` when it answered the list, and was
   * not stopping, both before and after it; undefined when it was not, and a
   * game missing from this list may be one the server stopped.
   */
  next(games: PublicGame[], now: number, run?: string): [string, Post][] {
    const first = this.seen === undefined;
    this.ended(games, run);
    const seen = (this.seen ??= new Map());
    const open = new Set<string>();
    for (const game of games) {
      // The list holds 100 games at most and is sorted by free seats: a game can
      // drop out of it and come back, so ids are remembered past their absence.
      const known = seen.has(game.id);
      seen.set(game.id, now);
      if (game.state !== "waiting") continue;
      open.add(game.id);
      // The games found on start were announced before, by an earlier run or nobody.
      if (known || first) continue;
      this.pending.set(game.id, {
        content:
          `New public game **${escapeMarkdown(game.name)}**, hosted by ${escapeMarkdown(game.host)} ` +
          `on ${escapeMarkdown(game.map)}, ${String(game.players)}/${String(game.capacity)} players: ` +
          `<${this.joinUrl(game.id)}>`,
        allowed_mentions: { parse: [] },
      });
    }
    for (const [id, time] of seen) if (now - time > REMEMBER_MS) seen.delete(id);
    // A game that started or closed meanwhile is no longer worth a post.
    for (const id of this.pending.keys())
      if (!id.startsWith("end:") && !open.has(id)) this.pending.delete(id);
    for (const id of [...this.pending.keys()].slice(0, -MAX_PENDING)) this.pending.delete(id);
    return [...this.pending];
  }

  /** Queues an end for each running game gone from the list, when its absence can be trusted. */
  private ended(games: PublicGame[], run: string | undefined): void {
    const listed = new Set(games.map((game) => game.id));
    // A full list may leave running games out, as they come after the open ones.
    const trusted = run !== undefined && run === this.run && games.length < MAX_LISTED;
    for (const [id, post] of this.running) {
      if (!trusted || listed.has(id)) continue;
      this.pending.set(`end:${id}`, post);
      this.running.delete(id);
    }
    // ponytail: a game that ends during a restart is never announced as ended;
    // the next run knows only the games it kept (FRONTFALL_DATA).
    if (run !== undefined && run !== this.run) {
      this.running.clear();
      this.run = run;
    }
    for (const game of games) {
      if (game.state !== "running") continue;
      this.running.set(game.id, {
        content: `The public game **${escapeMarkdown(game.name)}** on ${escapeMarkdown(game.map)} has ended.`,
        allowed_mentions: { parse: [] },
      });
    }
  }

  /** The webhook took this post. */
  posted(id: string): void {
    this.pending.delete(id);
  }
}

/** Where to read the games, and where to post. */
export interface AnnounceOptions {
  /** The game's page, such as https://example.org/frontfall/. */
  server: URL;
  webhook: URL;
  fetch?: typeof fetch;
}

/**
 * Reads the server once and posts what is new. Returns why the round fell
 * short, if it did, ends left out included; posts the webhook refused are
 * tried again next round.
 */
export async function announceOnce(
  announcer: Announcer,
  options: AnnounceOptions,
  now = Date.now(),
): Promise<string | undefined> {
  const get = options.fetch ?? fetch;
  const read = async (path: string): Promise<unknown> => {
    const response = await get(new URL(path, options.server), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`it answered ${String(response.status)}`);
    return response.json();
  };
  // The run the list belongs to: the same before and after it, and not stopping.
  const run = async (): Promise<string | undefined> => {
    const status = Status.safeParse(await read("api/status").catch(() => undefined));
    if (!status.success) throw new Error("no startedAt in /api/status");
    return status.data.state === "ok" ? status.data.startedAt : undefined;
  };
  let posts: [string, Post][];
  // Why ends are not posted, when /api/status cannot tell a restart: an older server, say.
  let blind: string | undefined;
  const runOrBlind = () =>
    run().catch((caught: unknown) => {
      blind = `ends are not posted: ${caught instanceof Error ? caught.message : String(caught)}`;
      return undefined;
    });
  try {
    const before = await runOrBlind();
    const games = GameList.parse(await read("api/games")).games;
    const after = await runOrBlind();
    posts = announcer.next(games, now, before === after ? before : undefined);
  } catch (caught) {
    return `could not read the server: ${caught instanceof Error ? caught.message : String(caught)}`;
  }
  for (const [id, post] of posts) {
    const response = await get(options.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(post),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
    // The body is never read: cancel it so a long-running loop does not hold the connection.
    await response?.body?.cancel();
    // Rate limited or out of reach: this post and the next wait for the next round.
    if (!response?.ok)
      return `the webhook answered ${response ? String(response.status) : "nothing"}`;
    announcer.posted(id);
  }
  return blind;
}
