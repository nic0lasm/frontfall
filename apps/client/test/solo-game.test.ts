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
  it("adds the map's nations after the bots, each on its tile (R-BOT-07)", () => {
    const base = generateMap(options.map);
    const land = [...base.kinds.keys()].filter((tile) => base.kinds[tile] !== TileKind.Water);
    const home = land[Math.floor(land.length / 2)] as number;
    const map = { ...base, nations: [{ name: "Norland", tile: home }] };
    const solo = new SoloGame({ ...options, nations: true }, map);
    let update = solo.step([]);
    expect(update.players.map((player) => [player.id, player.name])).toEqual([
      [1, "Ada"],
      [2, "Aldmere"],
      [3, "Brask"],
      [4, "Corvan"],
      [5, "Norland"],
    ]);
    while (update.phase === "spawn") update = solo.step([]);
    expect(solo.game.player(5)?.start).toBe(home);
    expect(solo.game.territory.ownerOf(home)).toBe(5);

    const without = new SoloGame(options, map);
    expect(without.step([]).players).toHaveLength(4);
  });

  it("deals the players into teams and records them (R-MODE-02)", () => {
    const solo = newGame({ ...options, teams: 2 });
    expect(solo.teamsById()).toEqual([0, 1, 2, 1, 2]);
    expect(solo.game.player(HUMAN_ID)?.team).toBe(1);
    expect(newGame(options).teamsById()).toEqual([]);
  });

  it("hands the operator's bonuses to the engine online (R-MODE-09)", () => {
    const players = [
      { id: 1, name: "Nico" },
      { id: 2, name: "Lea" },
    ];
    const operator = { player: 1, bonuses: 0b1010 };
    const solo = newGame({ ...options, players, you: 2, operator });
    expect(solo.game.operator).toEqual(operator);
    expect(newGame({ ...options, players, you: 2 }).game.operator.bonuses).toBe(0);
  });

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
  it("buys a warship at the player's port and sends the closest one to patrol (R-UNIT-04)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 10_000_000;
    // A patch of coast of the player's own, not enough to win.
    const coast = [...terrain.kinds.keys()].find((tile) => terrain.isCoast(tile)) ?? -1;
    for (const tile of terrain.topology.tilesWithin(coast, 4)) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    expect(solo.orderForClick(coast, 30, "warship")).toEqual({ refused: "port" });
    solo.step([{ type: "build", structure: 2, tile: coast }]);
    for (let i = 0; i < solo.game.balance.buildTicks; i++) solo.step([]);
    const buy = solo.orderForClick(coast, 30, "warship");
    expect(buy).toEqual({ order: { type: "warship", port: coast } });
    if (!("order" in buy)) throw new Error("refused");
    update = solo.step([buy.order]);
    expect(update.warships).toHaveLength(1);
    const ship = update.warships[0];
    const water =
      terrain.topology.neighbors(ship?.tile ?? 0).find((t) => terrain.kind(t) === TileKind.Water) ??
      -1;
    expect(solo.orderForClick(water, 30, "warship")).toEqual({
      order: { type: "patrol", ship: ship?.id, tile: water },
    });
  });

  it("aims a click at the holder shown when the tile has just fallen to the player", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const bot = solo.game.player(2);
    const shown = [...terrain.kinds.keys()].find(
      (tile) => terrain.isOwnable(tile) && territory.ownerOf(tile) === bot?.id,
    );
    if (shown === undefined) throw new Error("the bot holds no land");
    // The screen still shows the bot's flag here; the game has it as the player's already.
    territory.setOwner(shown, HUMAN_ID);
    expect(solo.orderForClick(shown, 30, "attack")).toEqual({ refused: "own" });
    expect(solo.orderForClick(shown, 30, "attack", undefined, HUMAN_ID)).toEqual({
      refused: "own",
    });
    const click = solo.orderForClick(shown, 30, "attack", undefined, bot?.id);
    if (!("order" in click) || click.order.type !== "attack") throw new Error("refused");
    expect(territory.ownerOf(click.order.target)).toBe(bot?.id);
    expect(click.order.target).not.toBe(shown);
  });

  it("launches a missile from a loaded silo, shows it in flight, then the fallout (R-UNIT-05, R-UNIT-06)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 10_000_000;
    // A patch of land of the player's own, not enough to win.
    const home = [...terrain.kinds.keys()].find((tile) => terrain.isOwnable(tile)) ?? -1;
    for (const tile of terrain.topology.tilesWithin(home, 4)) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    const bot = solo.game.player(2);
    const target = [...terrain.kinds.keys()].find((tile) => territory.ownerOf(tile) === bot?.id);
    if (target === undefined) throw new Error("the bot holds no land");
    expect(solo.orderForClick(target, 30, "missile")).toEqual({ refused: "silo" });
    expect(solo.orderForClick(home, 30, "silo")).toEqual({
      order: { type: "build", structure: 3, tile: home },
    });
    update = solo.step([{ type: "build", structure: 3, tile: home }]);
    expect(update.build.loaded).toBe(false);
    for (let i = 0; i < solo.game.balance.longBuildTicks; i++) update = solo.step([]);
    expect(update.build.loaded).toBe(true);
    const launch = solo.orderForClick(target, 30, "heavyMissile");
    expect(launch).toEqual({ order: { type: "missile", target, size: 1 } });
    if (!("order" in launch)) throw new Error("refused");
    update = solo.step([launch.order]);
    expect(update.missiles).toMatchObject([{ player: HUMAN_ID, heavy: true, to: target }]);
    expect(update.build.loaded).toBe(false);
    while (update.missiles.length > 0) update = solo.step([]);
    expect(update.fallout).toHaveLength(1);
    expect(update.fallout[0]?.tile).toBe(target);
    expect(update.fallout[0]).toMatchObject({
      heavy: true,
      duration: solo.game.balance.falloutTicks,
    });
    expect(update.fallout[0]?.ticksLeft).toBeGreaterThan(solo.game.balance.falloutTicks - 3);
    expect(update.missileEvents).toMatchObject([{ type: "struck", heavy: true, tile: target }]);
    expect(territory.ownerOf(target)).toBe(0);
  });

  it("says why a missile or a warship click sends nothing (R-UNIT-04, R-UNIT-05)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    const water = [...terrain.kinds.keys()].find((tile) => terrain.kind(tile) === TileKind.Water);
    const coast = [...terrain.kinds.keys()].find((tile) => terrain.isCoast(tile)) ?? -1;
    if (water === undefined) throw new Error("no water");
    // Nothing is bought or launched in the spawn phase.
    expect(solo.orderForClick(coast, 30, "missile")).toEqual({ refused: "early" });
    expect(solo.orderForClick(coast, 30, "warship")).toEqual({ refused: "early" });
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 10_000_000;
    for (const tile of terrain.topology.tilesWithin(coast, 4)) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    expect(solo.orderForClick(water, 30, "missile")).toEqual({ refused: "terrain" });
    expect(solo.orderForClick(water, 30, "warship")).toEqual({ refused: "noShip" });
    // A silo on a patch of land of the player's own, away from the port.
    const home = [...terrain.kinds.keys()].find(
      (tile) => terrain.isOwnable(tile) && terrain.topology.distance(tile, coast) > 30,
    );
    if (home === undefined) throw new Error("no land away from the coast");
    for (const tile of terrain.topology.tilesWithin(home, 4)) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    solo.step([
      { type: "build", structure: 2, tile: coast },
      { type: "build", structure: 3, tile: home },
    ]);
    for (let i = 0; i < solo.game.balance.longBuildTicks; i++) solo.step([]);
    human.gold = 0;
    expect(solo.orderForClick(coast, 30, "warship")).toEqual({ refused: "gold" });
    const bot = solo.game.player(2);
    const target = [...terrain.kinds.keys()].find((tile) => territory.ownerOf(tile) === bot?.id);
    if (target === undefined) throw new Error("the bot holds no land");
    expect(solo.orderForClick(target, 30, "missile")).toEqual({ refused: "gold" });
  });

  it("tells the player when an air defense stops their missile (R-BUILD-05)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory, structures } = solo.game;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 100_000_000;
    // The west half of the map is the player's, the east half the bot's.
    const width = terrain.topology.width;
    for (let tile = 0; tile < terrain.topology.size; tile++) {
      if (terrain.isOwnable(tile))
        territory.setOwner(tile, terrain.topology.x(tile) < width / 2 ? 1 : 2);
    }
    // The player's or the bot's tile away from coasts and borders closest to column `x`.
    const inland = (owner: number, x: number) => {
      let best = -1;
      for (let tile = 0; tile < terrain.topology.size; tile++) {
        if (territory.ownerOf(tile) !== owner || terrain.isCoast(tile) || territory.isBorder(tile))
          continue;
        const off = Math.abs(terrain.topology.x(tile) - x);
        if (best < 0 || off < Math.abs(terrain.topology.x(best) - x)) best = tile;
      }
      return best;
    };
    const silo = inland(1, Math.floor(width / 4));
    const defense = inland(2, Math.floor((2 * width) / 3));
    // Beyond the defense, out of its own blast.
    const target = inland(2, Math.floor((2 * width) / 3) + 24);
    expect([silo, defense, target].every((tile) => tile >= 0)).toBe(true);
    const bot = solo.game.player(2);
    if (!bot) throw new Error("no bot");
    bot.gold = 100_000_000;
    solo.game.apply(2, { type: "build", structure: 4, tile: defense });
    solo.step([{ type: "build", structure: 3, tile: silo }]);
    expect(structures.map((s) => s.kind).sort()).toEqual([3, 4]);
    for (let i = 0; i < solo.game.balance.longBuildTicks; i++) solo.step([]);
    // Three missiles in four are stopped: a few launches see one stopped.
    const seen: string[] = [];
    for (let shot = 0; shot < 4 && !seen.includes("stopped"); shot++) {
      while (!solo.step([]).build.loaded);
      update = solo.step([{ type: "missile", target, size: 0 }]);
      seen.push(...update.events.map((event) => event.type));
      while (solo.game.missiles.length > 0) {
        seen.push(...solo.step([]).events.map((event) => event.type));
      }
    }
    expect(seen).toContain("missile");
    expect(seen).toContain("stopped");
  });

  it("puts a port only by the water, and shows embargoes both ways (R-BUILD-02, R-DIPLO-05)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 1_000_000;
    for (let tile = 0; tile < terrain.topology.size; tile++) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    const topology = terrain.topology;
    const coast = [...terrain.kinds.keys()].find((tile) => terrain.isOceanCoast(tile)) ?? -1;
    // Further than a click reaches from any coast.
    const inland =
      [...terrain.kinds.keys()].find(
        (tile) =>
          terrain.isOwnable(tile) && !topology.tilesWithin(tile, 8).some((t) => terrain.isCoast(t)),
      ) ?? -1;
    expect(inland).toBeGreaterThanOrEqual(0);
    expect(solo.orderForClick(inland, 30, "port")).toEqual({ refused: "coast" });
    expect(solo.orderForClick(coast, 30, "port")).toEqual({
      order: { type: "build", structure: 2, tile: coast },
    });
    // The map has a lake: a port on its shore is built, with a word about trade.
    const shore =
      [...terrain.kinds.keys()].find(
        (tile) => terrain.isCoast(tile) && !terrain.isOceanCoast(tile),
      ) ?? -1;
    expect(solo.orderForClick(shore, 30, "port")).toEqual({
      order: { type: "build", structure: 2, tile: shore },
      note: "lake",
    });
    update = solo.step([{ type: "embargo", target: 2, on: 1 }]);
    expect(update.diplomacy.embargoes).toEqual([2]);
    expect(update.events).toContainEqual({ type: "embargo", a: HUMAN_ID, b: 2 });
    expect(update.tradeShips).toEqual([]);
  });

  it("puts a port on the coast closest to a click by the water, land or sea (R-BUILD-02)", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    const topology = terrain.topology;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 1_000_000;
    for (let tile = 0; tile < topology.size; tile++) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    // A coast tile with the sea to its north or south and land on the other side.
    const coast = [...terrain.kinds.keys()].find((tile) => {
      if (!terrain.isCoast(tile)) return false;
      const x = topology.x(tile);
      const y = topology.y(tile);
      if (y < 2 || y > topology.height - 3) return false;
      const north = topology.index(x, y - 1);
      const south = topology.index(x, y + 1);
      return (
        terrain.kind(north) === TileKind.Water &&
        terrain.isOwnable(south) &&
        !terrain.isCoast(south)
      );
    });
    if (coast === undefined) throw new Error("no coast with the sea to the north");
    const sea = topology.index(topology.x(coast), topology.y(coast) - 1);
    const land = topology.index(topology.x(coast), topology.y(coast) + 1);
    const order = { type: "build", structure: 2, tile: coast };
    // On a lake shore the port is built all the same, with a word about trade.
    const port = terrain.isOceanCoast(coast) ? { order } : { order, note: "lake" };
    // A click on the sea or on the land just behind finds the coast between them.
    expect(solo.orderForClick(sea, 30, "port")).toEqual(port);
    expect(solo.orderForClick(land, 30, "port")).toEqual(port);

    // Next to a structure, every coast in reach is too close: the refusal says so.
    // (Stepping would end the game: the player holds all the land.)
    solo.game.structures.push({
      id: 99,
      player: HUMAN_ID,
      kind: 0,
      tile: coast,
      readyAt: 0,
      reloadAt: 0,
    });
    expect(solo.orderForClick(sea, 30, "port")).toEqual({ refused: "crowded" });
    solo.game.structures.pop();

    // Without the gold, the closest coast says so.
    human.gold = 0;
    expect(solo.orderForClick(sea, 30, "port")).toEqual({ refused: "gold" });
  });

  it("previews a click without making it: where it lands, why not, how far it reaches", () => {
    const solo = newGame({ ...options, bots: 1 });
    const { terrain, territory } = solo.game;
    const topology = terrain.topology;
    let update = solo.step([]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 1_000_000;
    for (let tile = 0; tile < topology.size; tile++) {
      if (terrain.isOwnable(tile)) territory.setOwner(tile, HUMAN_ID);
    }
    const land = [...terrain.kinds.keys()].find((tile) => terrain.isOwnable(tile)) ?? -1;
    const queued = solo.game.structures.length;
    // A fort reaches as far as the engine says, and nothing was built by asking.
    expect(solo.previewClick(land, "fort")).toEqual({
      tile: land,
      radius: solo.game.balance.fortRadius,
    });
    expect(solo.previewClick(land, "city")).toEqual({ tile: land });
    expect(solo.previewClick(land, "airDefense").radius).toBeGreaterThan(0);
    expect(solo.previewClick(land, "mosque").radius).toBe(
      solo.previewClick(land, "airDefense").radius,
    );
    expect(solo.game.structures).toHaveLength(queued);
    // A port snaps to the coast beside the click, and a click far inland says why not.
    const coast = [...terrain.kinds.keys()].find((tile) => terrain.isOceanCoast(tile)) ?? -1;
    expect(solo.previewClick(coast, "port")).toEqual({ tile: coast });
    const inland =
      [...terrain.kinds.keys()].find(
        (tile) =>
          terrain.isOwnable(tile) && !topology.tilesWithin(tile, 8).some((t) => terrain.isCoast(t)),
      ) ?? -1;
    expect(solo.previewClick(inland, "port")).toEqual({ tile: inland, refused: "coast" });
    // The refusals the click would give, with the reach kept for structures that have one.
    human.gold = 0;
    expect(solo.previewClick(land, "fort")).toEqual({
      tile: land,
      refused: "gold",
      radius: solo.game.balance.fortRadius,
    });
    expect(solo.previewClick(land, "missile")).toEqual({ tile: land, refused: "silo" });
  });

  it("aims a port or a warship at the coast from as far as the zoom lets a click miss it (R-BUILD-02, R-UNIT-04)", () => {
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
      {
        id: "islands",
        width,
        height,
        wrapsX: false,
        kinds,
        relief: new Uint8Array(kinds.length),
        nations: [],
        landmarks: [],
      },
    );
    let update = solo.step([{ type: "spawn", tile: at(9, 6) }]);
    while (update.phase === "spawn") update = solo.step([]);
    const { territory } = solo.game;
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 10_000_000;
    for (let y = 2; y < 12; y++) {
      for (let x = 2; x < 12; x++) territory.setOwner(at(x, y), HUMAN_ID);
    }

    // Out at sea, 6 tiles off the player's coast: zoomed in that is far, zoomed out a few pixels.
    const sea = at(17, 6);
    expect(solo.orderForClick(sea, 30, "port", 4)).toEqual({ refused: "coast" });
    const port = solo.orderForClick(sea, 30, "port", 8);
    expect(port).toEqual({ order: { type: "build", structure: 2, tile: at(11, 6) } });
    solo.step(["order" in port ? port.order : []].flat());
    for (let i = 0; i < solo.game.balance.buildTicks; i++) solo.step([]);

    // The port's icon is a few pixels wide: a click as far as a port reaches buys there.
    expect(solo.orderForClick(at(5, 6), 30, "warship", 4)).toEqual({ refused: "port" });
    const buy = solo.orderForClick(at(5, 6), 30, "warship", 8);
    expect(buy).toEqual({ order: { type: "warship", port: at(11, 6) } });
    update = solo.step(["order" in buy ? buy.order : []].flat());
    const ship = update.warships[0];
    if (!ship) throw new Error("no warship");

    // A click on the far island, by its coast, sends the warship to the water closest to it.
    const patrol = solo.orderForClick(at(28, 6), 30, "warship", 4);
    expect(patrol).toEqual({ order: { type: "patrol", ship: ship.id, tile: at(25, 6) } });
    expect(solo.orderForClick(at(30, 6), 30, "warship", 2)).toEqual({ refused: "port" });
  });

  it("sends gifts, shows who is at war, and keeps the game's left-out options in its record (R-DIPLO-06, R-MODE-03)", () => {
    const solo = newGame({ ...options, bots: 1, disabled: 8 });
    const land = firstLand(options.map);
    let update = solo.step([{ type: "spawn", tile: land }]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = solo.game.player(HUMAN_ID);
    if (!human) throw new Error("no human");
    human.gold = 1_000_000;
    expect(solo.orderForClick(land, 30, "silo")).toEqual({ refused: "disabled" });
    update = solo.step([{ type: "gift", target: 2, troops: 0, gold: 400_000 }]);
    expect(solo.game.player(2)?.gold).toBeGreaterThanOrEqual(400_000);
    expect(update.events).toContainEqual({ type: "gift", a: HUMAN_ID, b: 2 });
    expect(update.diplomacy.atWar).toEqual([]);
    update = solo.step([{ type: "embargo", target: 2, on: 1 }]);
    expect(update.diplomacy.atWar).toEqual([2]);
    expect(solo.game.disabled).toBe(8);
  });

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
      {
        id: "islands",
        width,
        height,
        wrapsX: false,
        kinds,
        relief: new Uint8Array(kinds.length),
        nations: [],
        landmarks: [],
      },
    );
    // A start on the shore: ships leave from the coasts the player holds.
    let update = solo.step([{ type: "spawn", tile: at(9, 6) }]);
    while (update.phase === "spawn") update = solo.step([]);

    const coast = at(26, 6);
    const result = solo.orderForClick(coast, 50);
    expect(result).toMatchObject({ order: { type: "embark", target: coast } });
    // Inland, the ship lands on the coast closest to the click, within the reach of a click.
    const inland = solo.orderForClick(at(30, 6), 50, "attack", 6);
    expect(inland).toMatchObject({ order: { type: "embark" } });
    const landing = "order" in inland && inland.order.type === "embark" ? inland.order.target : -1;
    expect(solo.game.terrain.isCoast(landing)).toBe(true);
    expect(solo.game.terrain.topology.distance(landing, at(30, 6))).toBe(4);
    expect(solo.orderForClick(at(30, 6), 50, "attack", 2)).toEqual({ refused: "unreachable" });
    // On the sea by the far island, the same: its closest coast is the target.
    expect(solo.orderForClick(at(24, 6), 50, "attack", 6)).toMatchObject({
      order: { type: "embark", target: coast },
    });
    expect(solo.orderForClick(at(19, 6), 50, "attack", 2)).toEqual({ refused: "terrain" });

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

  it("starts from a snapshot after a reload and plays on as the game that never stopped (#39)", () => {
    const tile = firstLand(online.map);
    const spawn = { tick: 0, orders: [{ player: 1, order: { type: "spawn" as const, tile } }] };
    const turns = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => ({ tick: from + i, orders: [] }));
    const original = newGame(online);
    original.playTurns([spawn, ...turns(1, 300)]);
    const snapshot = original.snapshot();
    expect(snapshot.tick).toBe(300);
    expect(snapshot.history).toEqual([spawn]);

    const resumed = newGame({ ...online, snapshot });
    expect(resumed.snapshotRefused).toBeUndefined();
    expect(resumed.game.tick).toBe(300);
    const expected = original.playTurns(turns(300, 500)).hashes;
    expect(resumed.playTurns(turns(300, 500)).hashes).toEqual(expected);
    expect(resumed.snapshot().history).toEqual([spawn]);
  });

  it("shows a game taken back whole, without playing a tick", () => {
    const tile = firstLand(online.map);
    const spawn = { tick: 0, orders: [{ player: 1, order: { type: "spawn" as const, tile } }] };
    const original = newGame(online);
    original.playTurns([
      spawn,
      ...Array.from({ length: 50 }, (_, i) => ({ tick: 1 + i, orders: [] })),
    ]);
    const resumed = newGame({ ...online, snapshot: original.snapshot() });
    const update = resumed.current();
    expect(update.tick).toBe(51);
    expect(resumed.game.tick).toBe(51);
    expect(update.owners?.[tile]).toBe(1);
    expect(update.players.find((p) => p.id === 1)?.tiles).toBeGreaterThan(0);
  });

  it("starts from the first tick when its snapshot cannot be loaded", () => {
    const game = newGame(online);
    game.playTurns(Array.from({ length: 60 }, (_, tick) => ({ tick, orders: [] })));
    const snapshot = game.snapshot();
    const damaged = { ...snapshot, bytes: snapshot.bytes.slice(0, -1) };
    for (const refused of [
      newGame({ ...online, snapshot: damaged }),
      newGame({ ...online, seed: 12, snapshot }),
    ]) {
      expect(refused.snapshotRefused).toEqual(expect.any(String));
      expect(refused.game.tick).toBe(0);
      expect(refused.snapshot().history).toEqual([]);
    }
  });

  it("refuses a turn out of step with the game", () => {
    expect(() => newGame(online).playTurns([{ tick: 3, orders: [] }])).toThrow(RangeError);
  });
});
