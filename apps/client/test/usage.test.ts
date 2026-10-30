import { parseUsageReport } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import {
  browserOf,
  deviceOf,
  Usage,
  whereOf,
  type GameFacts,
  type UsageEnvironment,
} from "../src/usage.ts";

const FACTS: GameFacts = {
  mode: "solo",
  map: "world",
  teams: 0,
  nations: true,
  bots: 20,
  humans: 1,
  difficulty: "normal",
  disabled: 0,
  view: "flat",
};

function environment(overrides: Partial<UsageEnvironment> = {}) {
  const sent: { url: string; body: string }[] = [];
  const env: UsageEnvironment = {
    href: "https://nclsmgr.com/frontfall/?map=world",
    origin: "https://nclsmgr.com",
    optedOut: false,
    automated: false,
    coarsePointer: false,
    screenSide: 1080,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    send: (url, body) => sent.push({ url, body }),
    randomBytes: (count) => new Uint8Array(count).fill(171),
    ...overrides,
  };
  const reports = () => sent.map(({ body }) => JSON.parse(body) as Record<string, unknown>);
  return { env, sent, reports };
}

describe("deviceOf", () => {
  it("tells phones and tablets from computers", () => {
    expect(deviceOf(false, 400)).toBe("desktop");
    expect(deviceOf(true, 390)).toBe("phone");
    expect(deviceOf(true, 820)).toBe("tablet");
    expect(deviceOf(true, 1200)).toBe("desktop");
  });
});

describe("Usage", () => {
  it("reports the delay of the first order, once, and none when there was none", () => {
    const { env, reports } = environment();
    const usage = new Usage(env);
    const ordered = usage.track(FACTS, 0);
    ordered.firstOrder(12_400);
    ordered.firstOrder(50_000);
    ordered.end("defeat", 90_000);
    usage.track(FACTS, 0).end("left", 30_000);
    expect(reports()[0]).toMatchObject({ firstOrder: 12 });
    expect(reports()[1]).not.toHaveProperty("firstOrder");
  });

  it("reports what was used, the land held and the median frame time, and nothing of the rest", () => {
    const { env, reports } = environment();
    const tracker = new Usage(env).track(FACTS, 0);
    const glimpse = (tiles: number, extra = {}) => ({
      you: 1,
      phase: "play",
      players: [
        { id: 1, tiles },
        { id: 2, tiles: 100 - tiles },
      ],
      structures: [{ player: 1, type: "palace", ready: true }],
      boats: [],
      warships: [],
      diplomacy: { allies: [] },
      ...extra,
    });
    tracker.observe(glimpse(40, { phase: "spawn" }), 20, 0);
    tracker.observe(glimpse(60), 20, 6_000);
    tracker.observe(glimpse(30, { boats: [{ player: 1 }] }), 40, 7_000);
    tracker.observe(glimpse(25), 30, 12_000);
    tracker.used("gift");
    tracker.end("defeat", 90_000);
    tracker.observe(glimpse(90), 20, 99_000);
    // city (bit 0), boat (6), gift (8)
    expect(reports()[0]).toMatchObject({ used: 1 + 64 + 256, peak: 60, share: 25, frameMs: 30 });
    expect(parseUsageReport(JSON.stringify(reports()[0])).ok).toBe(true);
  });

  it("says nothing of the land or the frames when the game was never seen in play", () => {
    const { env, reports } = environment();
    new Usage(env).track(FACTS, 0).end("left", 30_000);
    expect(reports()[0]).toMatchObject({ used: 0 });
    for (const name of ["peak", "share", "frameMs"]) expect(reports()[0]).not.toHaveProperty(name);
  });

  it("reports a game once, under the page's prefix, in a shape the server accepts", () => {
    const { env, sent, reports } = environment({ coarsePointer: true, screenSide: 390 });
    const tracker = new Usage(env).track(FACTS, 0);
    tracker.end("victory", 90_000);
    tracker.end("closed", 120_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://nclsmgr.com/frontfall/api/usage");
    expect(parseUsageReport(sent[0]?.body ?? "").ok).toBe(true);
    expect(reports()[0]).toMatchObject({
      kind: "game",
      game: "abababababababab",
      outcome: "victory",
      minutes: 1.5,
      device: "phone",
      touch: true,
    });
  });

  it("takes one vote per game, after it ended, and a reason only with a thumbs down", () => {
    const { env, reports } = environment();
    const tracker = new Usage(env).track(FACTS, 0);
    tracker.vote("up");
    expect(reports()).toHaveLength(0);
    tracker.end("defeat", 1000);
    tracker.vote("down", "too_hard");
    tracker.vote("up");
    const votes = reports().filter((report) => report.kind === "feedback");
    expect(votes).toEqual([
      {
        kind: "feedback",
        release: "0.0.0",
        game: "abababababababab",
        mode: "solo",
        outcome: "defeat",
        vote: "down",
        reason: "too_hard",
      },
    ]);
  });

  it("sends nothing when the browser asks not to be tracked, or a test tool drives it", () => {
    for (const overrides of [{ optedOut: true }, { automated: true }]) {
      const { env, sent } = environment(overrides);
      const usage = new Usage(env);
      usage.track(FACTS, 0).end("left", 1);
      usage.error("webgl");
      expect(sent).toHaveLength(0);
    }
  });

  it("sends an error's message only from the game's own code, scrubbed, five at most", () => {
    const { env, sent, reports } = environment();
    const usage = new Usage(env);
    usage.screen = "online";
    usage.error(
      "exception",
      'Bad tile 1234 for "Léa"',
      "https://nclsmgr.com/frontfall/assets/index-Ab12.js?v=1:1:2045",
    );
    usage.error("exception", "secret of an extension", "chrome-extension://abc/content.js:1:2");
    for (let index = 0; index < 10; index++) usage.error("rejection");
    expect(sent).toHaveLength(5);
    const context = { browser: "chromium", device: "desktop", screen: "online" };
    expect(reports()[0]).toEqual({
      kind: "error",
      release: "0.0.0",
      type: "exception",
      message: "Bad tile # for <text>",
      where: "index-Ab12.js:1:2045",
      ...context,
    });
    expect(reports()[1]).toEqual({
      kind: "error",
      release: "0.0.0",
      type: "exception",
      ...context,
    });
    for (const { body } of sent) expect(parseUsageReport(body).ok).toBe(true);
  });
});

describe("whereOf", () => {
  const origin = "https://nclsmgr.com";
  it("takes the first frame of the page's own code from a stack", () => {
    const chrome = [
      "TypeError: x is not a function",
      "    at f (chrome-extension://abc/inject.js:3:4)",
      "    at g (https://nclsmgr.com/frontfall/assets/game-screen-Q1w2.js:1:3456)",
    ].join("\n");
    expect(whereOf(chrome, origin)).toBe("game-screen-Q1w2.js:1:3456");
    const firefox = "g@https://nclsmgr.com/frontfall/assets/main-X.js:2:30\n";
    expect(whereOf(firefox, origin)).toBe("main-X.js:2:30");
  });

  it("never takes a place from the error's message", () => {
    const { env, reports } = environment();
    const usage = new Usage(env);
    const message = "No seat at https://nclsmgr.com/Alice:1:2";
    usage.error("rejection", message, `Error: ${message}\n    at https://x.example/a.js:1:1`);
    expect(reports()[0]?.where).toBeUndefined();
    expect(whereOf("https://nclsmgr.com/frontfall/?game=Alice:1:2", "https://nclsmgr.com")).toBe(
      undefined,
    );
  });

  it("says nothing of code from elsewhere", () => {
    expect(whereOf("https://evil.example/a.js:1:1", origin)).toBeUndefined();
    expect(whereOf("https://nclsmgr.com.evil.example/a.js:1:1", origin)).toBeUndefined();
    expect(whereOf("", origin)).toBeUndefined();
    expect(whereOf(undefined, origin)).toBeUndefined();
  });
});

describe("browserOf", () => {
  it("names the engine family", () => {
    expect(
      browserOf("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
    ).toBe("firefox");
    expect(browserOf("Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/18 Safari/605")).toBe(
      "safari",
    );
    expect(browserOf("Mozilla/5.0 (iPhone) AppleWebKit/605 CriOS/140 Mobile Safari/604")).toBe(
      "safari",
    );
    expect(browserOf("Mozilla/5.0 (Windows) Chrome/140.0 Safari/537.36 Edg/140")).toBe("chromium");
    expect(browserOf("curl/8")).toBe("other");
  });
});
