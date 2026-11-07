import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES } from "@frontfall/protocol";
import { GAMES_REFRESH_MS, publicGames, watchPublicGames } from "../src/net/public-games.ts";

const ENDPOINT = new URL("http://host/api/games");

const game = {
  id: "game-0001",
  name: "Evening game",
  host: "Ada",
  map: "skirmish",
  bots: 2,
  nations: false,
  teams: 0,
  disabled: 0,
  rules: { ...DEFAULT_RULES },
  players: 1,
  capacity: 4,
  state: "waiting",
};

function answer(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const status = init.status ?? 200;
  return new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: init.etag ? { etag: init.etag } : {},
  });
}

describe("publicGames", () => {
  it("keeps the well-formed games and drops the rest", () => {
    const found = publicGames({ games: [game, { id: 3 }, "nope"] });
    expect(found.map((entry) => entry.id)).toEqual(["game-0001"]);
  });

  it("answers an empty list for a body that is not a list of games", () => {
    expect(publicGames(undefined)).toEqual([]);
    expect(publicGames({ games: "x" })).toEqual([]);
  });
});

describe("watchPublicGames", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches at once and again after the interval, sending the etag back", async () => {
    const sent: (HeadersInit | undefined)[] = [];
    const fake = vi.fn((_url: URL | string | Request, init?: RequestInit) => {
      sent.push(init?.headers);
      return Promise.resolve(
        sent.length === 1
          ? answer({ games: [game] }, { etag: '"a"' })
          : answer(null, { status: 304 }),
      );
    });
    const onGames = vi.fn();
    const stop = watchPublicGames({ onGames, url: ENDPOINT, fetch: fake });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({});
    expect(onGames).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(GAMES_REFRESH_MS);
    expect(fake).toHaveBeenCalledTimes(2);
    expect(sent[1]).toEqual({ "if-none-match": '"a"' });
    // 304: unchanged, so nothing is reported again.
    expect(onGames).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports an empty list when the server answers an error", async () => {
    const fake = vi.fn(() => Promise.resolve(answer({}, { status: 500 })));
    const onGames = vi.fn();
    const stop = watchPublicGames({ onGames, url: ENDPOINT, fetch: fake });
    await vi.advanceTimersByTimeAsync(0);
    expect(onGames).toHaveBeenCalledWith([]);
    stop();
  });

  it("keeps trying after a failed request and reports nothing for it", async () => {
    const fake = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(answer({ games: [] }));
    const onGames = vi.fn();
    const stop = watchPublicGames({ onGames, url: ENDPOINT, fetch: fake });
    await vi.advanceTimersByTimeAsync(0);
    expect(onGames).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(GAMES_REFRESH_MS);
    expect(onGames).toHaveBeenCalledWith([]);
    stop();
  });

  it("stops fetching once stopped, and drops an answer that arrives late", async () => {
    let release: (response: Response) => void = () => undefined;
    const fake = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const onGames = vi.fn();
    const stop = watchPublicGames({ onGames, url: ENDPOINT, fetch: fake });
    stop();
    release(answer({ games: [game] }));
    await vi.advanceTimersByTimeAsync(GAMES_REFRESH_MS * 3);
    expect(onGames).not.toHaveBeenCalled();
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
