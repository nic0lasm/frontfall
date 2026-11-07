import { PublicGame } from "@frontfall/protocol";

/** How often the list of public games is fetched again while it is watched. */
export const GAMES_REFRESH_MS = 3_000;

/** The games of a `/api/games` answer, leaving out anything malformed. */
export function publicGames(body: unknown): PublicGame[] {
  const games = (body as { games?: unknown } | undefined)?.games;
  if (!Array.isArray(games)) return [];
  return games.flatMap((game: unknown) => {
    const parsed = PublicGame.safeParse(game);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface WatchOptions {
  /** Called with the list each time the server's answer changed. */
  onGames: (games: readonly PublicGame[]) => void;
  /** The address of `api/games`; the page's own server by default. */
  url?: URL;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  intervalMs?: number;
}

/**
 * Fetches the public games now and again every few seconds, until the
 * returned function is called. An answer unchanged since the last one (304
 * for the same etag) is not reported. A failed request, as with no server
 * next to the page, reports nothing and is tried again.
 */
export function watchPublicGames(options: WatchOptions): () => void {
  const {
    onGames,
    url = new URL("api/games", location.href),
    fetch: request = fetch,
    intervalMs = GAMES_REFRESH_MS,
  } = options;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let etag: string | undefined;
  const refresh = async (): Promise<void> => {
    try {
      const response = await request(url, { headers: etag ? { "if-none-match": etag } : {} });
      if (response.status !== 304) {
        const body: unknown = response.ok ? await response.json() : undefined;
        etag = response.headers.get("etag") ?? undefined;
        // The watcher may have stopped while the request ran.
        if (!stopped) onGames(publicGames(body));
      }
    } catch {
      // No server next to the page, as in a static preview.
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void refresh();
      }, intervalMs);
    }
  };
  void refresh();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
