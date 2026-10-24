import { TileKind } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { GENERATED_MAPS, generateMap } from "../src/game/maps.ts";
import { HUMAN_ID, SoloGame, type SoloOptions } from "../src/game/solo-game.ts";

const options: SoloOptions = {
  map: "skirmish",
  seed: 11,
  bots: 3,
  difficulty: "normal",
  playerName: "Ada",
};

function newGame(game: SoloOptions): SoloGame {
  return new SoloGame(game, generateMap(game.map));
}

function firstLand(map: string): number {
  return generateMap(map).kinds.findIndex((kind) => kind !== TileKind.Water);
}

describe("maps", () => {
  it("generates every listed map identically twice", () => {
    for (const { id, width, height } of GENERATED_MAPS) {
      const map = generateMap(id);
      expect(map.kinds).toHaveLength(width * height);
      expect(generateMap(id).kinds).toEqual(map.kinds);
      expect(map.kinds.some((kind) => kind !== TileKind.Water)).toBe(true);
    }
  });

  it("rejects an unknown map", () => {
    expect(() => generateMap("atlantis")).toThrow(RangeError);
  });
});

describe("SoloGame", () => {
  it("places the human where they click and reports the tiles that changed", () => {
    const solo = newGame(options);
    const tile = firstLand(options.map);
    const update = solo.step([{ type: "spawn", tile }]);
    expect(update.phase).toBe("spawn");
    expect(update.players.map((player) => player.name)).toEqual([
      "Ada",
      "Aldmere",
      "Brask",
      "Corvan",
    ]);
    const human = update.players.find((player) => player.id === HUMAN_ID);
    expect(human?.tiles).toBeGreaterThan(0);
    expect(update.changedTiles).toContain(tile);
    const index = update.changedTiles.indexOf(tile);
    expect(update.changedOwners[index]).toBe(HUMAN_ID);
    expect(solo.step([]).changedTiles).toHaveLength(0);
  });

  it("places everyone at the end of the spawn phase and gives the same result twice", () => {
    const run = (): number[] => {
      const solo = newGame(options);
      let update = solo.step([]);
      while (update.phase === "spawn") update = solo.step([]);
      expect(update.spawnTicksLeft).toBe(0);
      return update.players.map((player) => player.tiles);
    };
    const tiles = run();
    expect(tiles.every((count) => count > 0)).toBe(true);
    expect(run()).toEqual(tiles);
  });

  it("plays a whole game against hard bots to a winner, then plays on for spectators (R-WIN-01, R-WIN-03)", () => {
    const solo = newGame({ ...options, difficulty: "hard" });
    let update = solo.step([]);
    while (update.winner === undefined && update.tick < 6000) update = solo.step([]);
    expect(update.winner).toBeDefined();
    expect(update.phase).toBe("play");
    const next = solo.step([]);
    expect(next.tick).toBe(update.tick + 1);
    expect(next.winner).toBe(update.winner);
  }, 60_000);
});

describe("SoloGame attacks", () => {
  it("expands into unowned land after a click once the spawn phase is over", () => {
    const solo = newGame({ ...options, bots: 1 });
    const start = firstLand(options.map);
    let update = solo.step([{ type: "spawn", tile: start }]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = (): number => update.players.find((player) => player.id === HUMAN_ID)?.tiles ?? 0;
    const before = human();
    const { territory, terrain } = solo.game;
    // Any unowned land: the front heads towards it.
    const target = territory.owners.findIndex(
      (owner, tile) => owner === 0 && terrain.isOwnable(tile),
    );
    update = solo.step([{ type: "attack", target, troops: 1000 }]);
    expect(update.attacks).toHaveLength(1);
    for (let i = 0; i < 20; i++) update = solo.step([]);
    expect(human()).toBeGreaterThan(before);
  });

  it("calls an attack back by the id the update gives it", () => {
    const solo = newGame({ ...options, bots: 1 });
    let update = solo.step([{ type: "spawn", tile: firstLand(options.map) }]);
    while (update.phase === "spawn") update = solo.step([]);
    const { territory, terrain } = solo.game;
    const target = territory.owners.findIndex(
      (owner, tile) => owner === 0 && terrain.isOwnable(tile),
    );
    update = solo.step([{ type: "attack", target, troops: 1000 }]);
    const [attack] = update.attacks;
    expect(attack?.target).toBe(0);
    update = solo.step([{ type: "retreat", attack: attack?.id ?? -1 }]);
    expect(update.attacks).toEqual([]);
  });
});

describe("SoloGame clicks", () => {
  it("builds and demolishes in the mode the HUD picked, and reports structures (R-BUILD)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const land = firstLand(options.map);
    expect(solo.orderForClick(land, 30, "city")).toEqual({ refused: "early" });
    let update = solo.step([{ type: "spawn", tile: land }]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    expect(solo.orderForClick(land, 30, "city")).toEqual({ refused: "gold" });
    human.gold = 1_000_000;
    const foreign = solo.game.territory.owners.findIndex(
      (owner, tile) => owner !== HUMAN_ID && solo.game.terrain.isOwnable(tile),
    );
    expect(solo.orderForClick(foreign, 30, "fort")).toEqual({ refused: "foreign" });
    const build = solo.orderForClick(land, 30, "city");
    expect(build).toEqual({ order: { type: "build", structure: 0, tile: land } });
    if (!("order" in build)) throw new Error("the build was refused");
    update = solo.step([build.order]);
    expect(update.structures).toEqual([
      { id: 1, player: HUMAN_ID, type: "city", tile: land, ready: false },
    ]);
    expect(update.build.cities).toBe(1);
    expect(update.build.cityCost).toBeGreaterThan(solo.game.balance.cityCost);
    expect(solo.orderForClick(land, 30, "fort")).toEqual({ refused: "crowded" });
    // A click a tile away still finds the city to demolish.
    const near = solo.game.terrain.topology.neighbors(land)[0] ?? land;
    expect(solo.orderForClick(near, 30, "demolish")).toEqual({
      order: { type: "demolish", tile: land },
    });
    expect(solo.orderForClick(foreign, 30, "demolish")).toEqual({ refused: "nothing" });
  });

  it("shows alliances, requests and traitors, and tells everyone what happened (R-DIPLO)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const land = firstLand(options.map);
    let update = solo.step([{ type: "spawn", tile: land }]);
    while (update.phase === "spawn") update = solo.step([]);
    const bot = 2;
    const ask = (from: number, to: number) =>
      solo.playTurns([
        { tick: solo.game.tick, orders: [{ player: from, order: { type: "ally", target: to } }] },
      ]);
    update = ask(bot, HUMAN_ID);
    expect(update.diplomacy.incoming).toEqual([
      { from: bot, ticksLeft: solo.game.balance.allianceRequestTicks - 1 },
    ]);
    update = solo.step([{ type: "ally", target: bot }]);
    expect(update.events).toEqual([{ type: "allied", a: HUMAN_ID, b: bot }]);
    expect(update.diplomacy.allies.map((ally) => ally.id)).toEqual([bot]);
    expect(update.diplomacy.incoming).toEqual([]);
    expect(solo.step([]).events).toEqual([]);
    // The bot's land cannot be attacked while the alliance holds.
    const theirs = solo.game.territory.owners.indexOf(bot);
    expect(solo.orderForClick(theirs, 30)).toEqual({ refused: "ally" });
    update = solo.step([{ type: "betray", target: bot }]);
    expect(update.events).toEqual([{ type: "betrayed", a: HUMAN_ID, b: bot }]);
    expect(update.diplomacy.allies).toEqual([]);
    expect(update.diplomacy.traitors.map((traitor) => traitor.id)).toEqual([HUMAN_ID]);
    expect(update.diplomacy.waiting).toEqual([bot]);
  });

  it("turns a click into the order the phase allows", () => {
    const solo = newGame(options);
    const land = firstLand(options.map);
    expect(solo.orderForClick(land, 30)).toEqual({ order: { type: "spawn", tile: land } });
    expect(solo.orderForClick(0, 30)).toEqual({ refused: "terrain" });
    expect(solo.orderForClick(-1, 30)).toEqual({ refused: "terrain" });

    let update = solo.step([{ type: "spawn", tile: land }]);
    while (update.phase === "spawn") update = solo.step([]);
    const troops = update.players.find((player) => player.id === HUMAN_ID)?.troops ?? 0;
    const { territory, terrain } = solo.game;
    const free = territory.owners.findIndex(
      (owner, tile) => owner === 0 && terrain.isOwnable(tile),
    );
    expect(solo.orderForClick(free, 30)).toEqual({
      order: { type: "attack", target: free, troops: Math.floor((troops * 30) / 100) },
    });
    expect(solo.orderForClick(land, 30)).toEqual({ refused: "own" });
    expect(solo.orderForClick(free, 0)).toEqual({ refused: "troops" });
  });

  it("sends ships to a coast across the sea, never inland (R-ATTACK-09)", () => {
    // Two islands, 10 x 10 tiles each, with 14 tiles of sea between them.
    const width = 40;
    const height = 14;
    const kinds = new Uint8Array(width * height).fill(TileKind.Water);
    const at = (x: number, y: number): number => y * width + x;
    for (let y = 2; y < 12; y++) {
      for (let x = 2; x < 12; x++) kinds[at(x, y)] = TileKind.Plains;
      for (let x = 26; x < 36; x++) kinds[at(x, y)] = TileKind.Plains;
    }
    const solo = new SoloGame(
      { ...options, bots: 0 },
      { id: "islands", width, height, wrapsX: false, kinds, relief: new Uint8Array(kinds.length) },
    );
    // A start on the shore: ships leave from the coasts the player holds.
    let update = solo.step([{ type: "spawn", tile: at(9, 6) }]);
    while (update.phase === "spawn") update = solo.step([]);

    const coast = at(26, 6);
    const result = solo.orderForClick(coast, 50);
    expect(result).toMatchObject({ order: { type: "embark", target: coast } });
    expect(solo.orderForClick(at(30, 6), 50)).toEqual({ refused: "unreachable" });

    update = solo.step(["order" in result ? result.order : []].flat());
    expect(update.boats).toHaveLength(1);
    expect(update.boats[0]).toMatchObject({ player: HUMAN_ID });
    for (let i = 0; i < 30 && solo.game.territory.ownerOf(coast) !== HUMAN_ID; i++) {
      update = solo.step([]);
    }
    expect(solo.game.territory.ownerOf(coast)).toBe(HUMAN_ID);
    expect(update.boats).toHaveLength(0);
    // Ashore, the rest of the island is reached by land.
    expect(solo.orderForClick(at(34, 6), 50)).toMatchObject({ order: { type: "attack" } });
  });
});

describe("SoloGame online", () => {
  const online: SoloOptions = {
    ...options,
    bots: 2,
    players: [
      { id: 1, name: "Nico" },
      { id: 2, name: "Léa" },
    ],
    you: 2,
  };

  it("numbers the humans as the server did and the bots after them", () => {
    const update = newGame(online).playTurns([{ tick: 0, orders: [] }]);
    expect(update.you).toBe(2);
    expect(update.players.map(({ id, name }) => [id, name])).toEqual([
      [1, "Nico"],
      [2, "Léa"],
      [3, "Aldmere"],
      [4, "Brask"],
    ]);
  });

  it("plays every player's orders from the relayed turns, the same way on every client", () => {
    const tile = firstLand(online.map);
    const run = () => {
      const game = newGame(online);
      const first = game.playTurns([
        { tick: 0, orders: [{ player: 1, order: { type: "spawn", tile } }] },
      ]);
      const turns = Array.from({ length: 100 }, (_, i) => ({ tick: i + 1, orders: [] }));
      return { first, rest: game.playTurns(turns) };
    };
    const a = run();
    expect(a.first.players.find((player) => player.id === 1)?.tiles).toBeGreaterThan(0);
    // Hashes after ticks 0, 50 and 100, for the server to compare between players.
    expect(a.first.hashes?.map((entry) => entry.tick)).toEqual([0]);
    expect(a.rest.hashes?.map((entry) => entry.tick)).toEqual([50, 100]);
    expect(run().rest.hashes).toEqual(a.rest.hashes);
  });

  it("takes clicks for the player at this screen", () => {
    const game = newGame(online);
    const result = game.orderForClick(firstLand(online.map), 30);
    expect(result).toEqual({ order: { type: "spawn", tile: firstLand(online.map) } });
  });

  it("refuses a turn out of step with the game", () => {
    expect(() => newGame(online).playTurns([{ tick: 3, orders: [] }])).toThrow(RangeError);
  });
});
