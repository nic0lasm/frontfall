import { describe, expect, it } from "vitest";
import { Directory, MAX_LISTED_GAMES, type Opening } from "../src/directory.ts";
import type { Peer, Room } from "../src/room.ts";
import { DEFAULT_GAME } from "../src/server.ts";

const peer: Peer = { send: () => undefined, probe: () => undefined };

const PRIVATE: Opening = { kind: "hosted", visibility: "private", name: null };
const hosted = (name: string): Opening => ({ kind: "hosted", visibility: "public", name });

function directory(maxRooms = 10) {
  return new Directory({
    maxRooms,
    maxLobbiesPerOwner: 2,
    publicGame: { ...DEFAULT_GAME, capacity: 2, minPlayers: 2 },
    privateGame: { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0 },
  });
}

function seat(room: Room | undefined, name: string) {
  const taken = room?.join(name, peer, 0);
  if (!room || !taken || typeof taken === "string") throw new Error("not seated");
  return taken;
}

describe("Directory", () => {
  it("fills the fullest public game first, then opens another", () => {
    const games = directory();
    const first = games.quickMatch(undefined, "Quick");
    first?.join("A", peer, 0);
    const empty = games.create({ kind: "quick", name: "Other" });
    expect(games.quickMatch(undefined, "Quick")).toBe(first);
    first?.join("B", peer, 0);
    expect(first?.state).toBe("running");
    expect(games.quickMatch(undefined, "Quick")).toBe(empty);
  });

  it("never sends Play now into a game that would turn the player away (R-MODE-05)", () => {
    const games = new Directory({
      maxRooms: 10,
      publicGame: { ...DEFAULT_GAME, capacity: 8, minPlayers: 2 },
      privateGame: { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0 },
    });
    const quick = games.quickMatch("10.0.0.1", "Quick");
    const host = quick?.join("Host", peer, 0, "10.0.0.1");
    const pest = quick?.join("Pest", peer, 0, "10.0.0.2");
    if (!quick || typeof host !== "object" || typeof pest !== "object") throw new Error();
    quick.kick(host, pest.id, 0);
    expect(games.quickMatch("10.0.0.2", "Quick")).not.toBe(quick);
    quick.join("B", peer, 0, "10.0.0.1");
    quick.join("C", peer, 0, "10.0.0.1");
    expect(games.quickMatch("10.0.0.1", "Quick")).not.toBe(quick);
    expect(games.quickMatch("10.0.0.3", "Quick")).toBe(quick);
  });

  it("never sends Play now into a game that waits for its host", () => {
    const games = directory();
    const listed = games.create(hosted("Europe 4v4"));
    listed?.join("Host", peer, 0);
    const quick = games.quickMatch(undefined, "Quick");
    expect(quick).not.toBe(listed);
    expect(quick?.settings.countdownMs).toBeGreaterThan(0);
  });

  it("never sends Play now into a game with a special rule (R-MODE-08)", () => {
    const games = directory();
    const special = games.quickMatch(undefined, "Quick");
    const host = seat(special, "Host");
    expect(special?.settings.rules).toEqual({ collapsingFronts: true, capitals: false });
    special?.configure(
      host,
      {
        map: "world",
        bots: 0,
        difficulty: "normal",
        nations: true,
        teams: 0,
        disabled: 0,
        capacity: 2,
        autoStart: true,
        rules: { collapsingFronts: true, capitals: true },
      },
      0,
    );
    const next = games.quickMatch(undefined, "Quick");
    expect(next).not.toBe(special);
    expect(next?.settings.rules).toEqual({ collapsingFronts: true, capitals: false });
  });

  it("never sends Play now into a quick game whose host stopped the countdown", () => {
    const games = new Directory({
      maxRooms: 10,
      publicGame: { ...DEFAULT_GAME, capacity: 4, minPlayers: 2 },
      privateGame: { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0 },
    });
    const held = games.quickMatch(undefined, "Quick");
    const host = seat(held, "Host");
    seat(held, "Guest");
    expect(held?.state).toBe("starting");
    expect(held?.hold(host, 0)).toBeUndefined();
    expect(held?.isHeld).toBe(true);
    const next = games.quickMatch(undefined, "Quick");
    expect(next).not.toBe(held);
    expect(next?.settings.countdownMs).toBeGreaterThan(0);
  });

  it("gives a quick game a countdown and a hosted one none", () => {
    const games = directory();
    expect(games.create({ kind: "quick", name: "Quick" })?.settings.countdownMs).toBe(60_000);
    const listed = games.create(hosted("Mine"))?.settings;
    expect(listed).toMatchObject({ countdownMs: 0, minPlayers: 2, visibility: "public" });
    expect(games.create(PRIVATE)?.settings).toMatchObject({ minPlayers: 1, name: null });
  });

  it("lists public games, waiting ones first by seats left then age, without secrets", () => {
    const games = directory();
    const older = games.create(hosted("Older"));
    seat(older, "Ann");
    const newer = games.create(hosted("Newer"));
    seat(newer, "Bea");
    const fuller = games.create(hosted("Fuller"));
    const host = seat(fuller, "Cid");
    seat(fuller, "Dan");
    const running = games.create(hosted("Running"));
    const starter = seat(running, "Eve");
    seat(running, "Fay");
    running?.requestStart(starter, 0);
    seat(games.create(PRIVATE), "Gus");
    const list = games.publicGames();
    expect(list.map((game) => [game.name, game.state])).toEqual([
      ["Fuller", "waiting"],
      ["Older", "waiting"],
      ["Newer", "waiting"],
      ["Running", "running"],
    ]);
    expect(list[0]).toEqual({
      id: fuller?.id,
      name: "Fuller",
      host: "Cid",
      map: "world",
      bots: 0,
      nations: true,
      teams: 0,
      disabled: 0,
      rules: { collapsingFronts: true, capitals: false },
      players: 2,
      capacity: 16,
      state: "waiting",
    });
    expect(JSON.stringify(list)).not.toContain(host.token);
  });

  it(`lists ${String(MAX_LISTED_GAMES)} games at most`, () => {
    const games = directory(MAX_LISTED_GAMES + 5);
    for (let i = 0; i < MAX_LISTED_GAMES + 5; i++)
      seat(games.create(hosted(`Game ${String(i)}`)), "A");
    expect(games.publicGames()).toHaveLength(MAX_LISTED_GAMES);
  });

  it("never lists two waiting games under the same name", () => {
    const games = directory();
    const first = games.create(hosted("Europe"));
    expect(first?.settings.name).toBe("Europe");
    expect(games.create(hosted("europe"))?.settings.name).toBe("europe (2)");
    expect(games.create(hosted("Europe"))?.settings.name).toBe("Europe (3)");
    expect(games.uniqueName("Europe", first)).toBe("Europe");
    const long = "x".repeat(32);
    games.create(hosted(long));
    expect(games.uniqueName(long)).toBe(`${"x".repeat(28)} (2)`);
  });

  it("gives every game a different id of at least 64 random bits", () => {
    const games = directory(1000);
    const ids = new Set(Array.from({ length: 1000 }, () => games.create(PRIVATE)?.id));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("caps the lobbies one address holds, public and private, not its running games", () => {
    const games = directory();
    const first = games.create(PRIVATE, "203.0.113.9");
    expect(games.create(hosted("Mine"), "203.0.113.9")).toBeDefined();
    expect(games.create(PRIVATE, "203.0.113.9")).toBeUndefined();
    expect(games.atLobbyLimit("203.0.113.9")).toBe(true);
    expect(games.create(PRIVATE, "198.51.100.4")).toBeDefined();
    first?.requestStart(seat(first, "A"), 0);
    expect(games.create(PRIVATE, "203.0.113.9")?.owner).toBe("203.0.113.9");
    // "Play now" still opens a game when none waits: it is not one more lobby to spam.
    expect(games.atLobbyLimit("203.0.113.9")).toBe(true);
    expect(games.quickMatch("203.0.113.9", "Quick")).toBeDefined();
  });

  it("caps the number of games", () => {
    const games = directory(1);
    expect(games.create(PRIVATE)).toBeDefined();
    expect(games.create(hosted("Full"))).toBeUndefined();
    expect(games.quickMatch(undefined, "Quick")).toBeUndefined();
  });

  it("finds the seat of a running game by token", () => {
    const games = directory();
    const room = games.quickMatch(undefined, "Quick");
    const taken = seat(room, "A");
    room?.join("B", peer, 0);
    expect(games.findSeat(taken.token)).toEqual({ room, seat: taken });
    expect(games.findSeat("unknown-token-000")).toBeUndefined();
  });

  it("forgets finished games within one tick", () => {
    const games = directory();
    const room = games.create(PRIVATE);
    const taken = seat(room, "A");
    room?.requestStart(taken, 0);
    room?.leave(taken, 0);
    games.update(DEFAULT_GAME.reconnectGraceMs);
    expect(games.size).toBe(0);

    games.create(hosted("Gone"));
    games.stopAll();
    expect(games.size).toBe(0);
  });
});
