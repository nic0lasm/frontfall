import { PublicGame } from "@frontfall/protocol";
import { z } from "zod";

// Announces on a Discord webhook the public games that /api/games lists as open.
// Ends are not announced: the server never learns who won (it only relays
// turns), and a game that leaves the list may have been stopped by a restart.

/** What `/api/games` answers; see docs/protocol.md, "HTTP endpoints". */
export const GameList = z.object({ games: z.array(PublicGame) });

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
  /** Announcements not posted yet, by game id. */
  private pending = new Map<string, Post>();

  /** @param joinUrl The page that joins a game, given its id. */
  constructor(private readonly joinUrl: (id: string) => string) {}

  /**
   * Takes one list of public games and returns what to post: the games newly
   * open, after those the webhook refused before and that are still open.
   */
  next(games: PublicGame[], now: number): [string, Post][] {
    const first = this.seen === undefined;
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
    for (const id of this.pending.keys()) if (!open.has(id)) this.pending.delete(id);
    for (const id of [...this.pending.keys()].slice(0, -MAX_PENDING)) this.pending.delete(id);
    return [...this.pending];
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
 * short, if it did; posts the webhook refused are tried again next round.
 */
export async function announceOnce(
  announcer: Announcer,
  options: AnnounceOptions,
  now = Date.now(),
): Promise<string | undefined> {
  const get = options.fetch ?? fetch;
  let posts: [string, Post][];
  try {
    const response = await get(new URL("api/games", options.server), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`it answered ${String(response.status)}`);
    posts = announcer.next(GameList.parse(await response.json()).games, now);
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
  return undefined;
}
