import { DEFAULT_RULES, type PublicGame } from "@frontfall/protocol";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Announcer, announceOnce, escapeMarkdown, type Post } from "../src/announce.ts";

const game = (
  id: string,
  state: PublicGame["state"] = "waiting",
  name = `Game ${id}`,
): PublicGame => ({
  // Game ids hold 8 to 32 letters, digits, - and _.
  id: id.padEnd(8, "_"),
  name,
  host: "Ada",
  map: "world",
  bots: 0,
  nations: true,
  teams: 0,
  disabled: 0,
  rules: DEFAULT_RULES,
  players: 1,
  capacity: 8,
  state,
});

/** A fake game server and a fake webhook, on one port. */
let fake: Server;
let base: URL;
let games: PublicGame[] | undefined;
let received: Post[];
let webhookStatus: number;

beforeEach(async () => {
  games = [];
  received = [];
  webhookStatus = 204;
  fake = createServer((request, response) => {
    if (request.url === "/frontfall/api/games") {
      if (!games) response.writeHead(503).end();
      else response.writeHead(200).end(JSON.stringify({ games, running: 0 }));
    } else if (request.url === "/webhook" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        if (webhookStatus < 300) received.push(JSON.parse(body) as Post);
        response.writeHead(webhookStatus).end();
      });
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  base = new URL(`http://127.0.0.1:${String((fake.address() as AddressInfo).port)}/`);
});

afterEach(async () => {
  await new Promise((resolve) => fake.close(resolve));
});

const options = () => ({ server: new URL("frontfall/", base), webhook: new URL("webhook", base) });
const HOUR = 60 * 60 * 1000;

describe("Discord announcer", () => {
  it("posts once when a public game opens, mentioning nobody, and nothing for games found on start", async () => {
    const announcer = new Announcer((id) => `https://example.org/?game=${id}`);
    games = [game("old")];
    expect(await announceOnce(announcer, options(), 0)).toBeUndefined();
    expect(received).toEqual([]);

    games = [game("old"), game("new", "waiting", "Night @everyone")];
    await announceOnce(announcer, options(), 1);
    await announceOnce(announcer, options(), 2);
    games = [game("old"), game("new", "running", "Night @everyone"), game("run", "running")];
    await announceOnce(announcer, options(), 3);
    expect(received).toEqual([
      {
        content:
          "New public game **Night \\@everyone**, hosted by Ada on world, 1/8 players: " +
          "<https://example.org/?game=new_____>",
        allowed_mentions: { parse: [] },
      },
    ]);
  });

  it("does not announce again a game that left the list for a while", async () => {
    // The list stops at 100 games: a lobby can drop out of it and come back.
    const announcer = new Announcer((id) => id);
    await announceOnce(announcer, options(), 0);
    games = [game("a")];
    await announceOnce(announcer, options(), HOUR);
    games = [];
    await announceOnce(announcer, options(), 2 * HOUR);
    games = undefined;
    expect(await announceOnce(announcer, options(), 3 * HOUR)).toMatch(/could not read the server/);
    games = [game("a")];
    await announceOnce(announcer, options(), 4 * HOUR);
    expect(received).toHaveLength(1);
  });

  it("announces a game that opened while the server was out of reach", async () => {
    const announcer = new Announcer((id) => id);
    await announceOnce(announcer, options(), 0);
    games = undefined;
    await announceOnce(announcer, options(), 1);
    games = [game("a")];
    await announceOnce(announcer, options(), 2);
    expect(received).toHaveLength(1);
  });

  it("tries a refused post again, in order, while its game is still open", async () => {
    const announcer = new Announcer((id) => id);
    await announceOnce(announcer, options(), 0);
    games = [game("a"), game("b"), game("c")];
    webhookStatus = 429;
    expect(await announceOnce(announcer, options(), 1)).toBe("the webhook answered 429");

    webhookStatus = 204;
    games = [game("a"), game("b", "running"), game("c")];
    expect(await announceOnce(announcer, options(), 2)).toBeUndefined();
    expect(received.map((post) => post.content.match(/<(\w+)>/)?.[1])).toEqual([
      "a_______",
      "c_______",
    ]);
    await announceOnce(announcer, options(), 3);
    expect(received).toHaveLength(2);
  });

  it("keeps the last 20 posts while the webhook refuses them all", async () => {
    const announcer = new Announcer((id) => id);
    await announceOnce(announcer, options(), 0);
    webhookStatus = 404;
    games = Array.from({ length: 30 }, (_, index) => game(`g${String(index)}`));
    await announceOnce(announcer, options(), 1);
    webhookStatus = 204;
    await announceOnce(announcer, options(), 2);
    expect(received).toHaveLength(20);
    expect(received[0]?.content).toContain("<g10_____>");
  });

  it("escapes Discord formatting and cuts long names", () => {
    expect(escapeMarkdown("a_b*c`d|e")).toBe("a\\_b\\*c\\`d\\|e");
    expect(escapeMarkdown("x".repeat(500))).toHaveLength(100);
  });
});
