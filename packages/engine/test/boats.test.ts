import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { reachableCoasts, seaRoute } from "../src/boats.ts";
import { createGame } from "../src/create-game.ts";
import type { Order, Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";
import { WHOLE_PRICES } from "./whole-prices.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 0,
  ...WHOLE_PRICES,
  tileWeightTenths: [100, 100, 100],
  attackSpeedDivisor: 1000,
  boatSpeed: 2,
};

/**
 * A wrapping map drawn with "." for water, "#" for plains and "X" for
 * impassable land. Digits are plains owned by that player.
 */
function newGame(rows: string[], overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid((rows[0] as string).length, rows.length);
  const cells = rows.join("");
  const kinds = new Uint8Array(grid.size);
  for (let tile = 0; tile < grid.size; tile++) {
    const cell = cells[tile] as string;
    kinds[tile] =
      cell === "." ? TileKind.Water : cell === "X" ? TileKind.Impassable : TileKind.Plains;
  }
  const game = createGame({
    terrain: new Terrain(grid, kinds),
    seed: 5,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  for (let tile = 0; tile < grid.size; tile++) {
    const owner = Number(cells[tile]);
    if (owner > 0) game.territory.setOwner(tile, owner);
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  ada.troops = 1000;
  bea.troops = 1000;
  const run = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const embark = (player: number, target: number, troops: number) => ({
    player,
    order: { type: "embark", target, troops } as Order,
  });
  return { grid, game, ada, bea, run, embark };
}

// Two islands: from the east one, the short way west crosses the east-west seam.
const islands = [
  "XXXXXXXXXXXXXXXXXXXX", //
  "#11..........#22....",
  "#11..........#22....",
  "XXXXXXXXXXXXXXXXXXXX",
];

describe("sea routes (R-UNIT-02)", () => {
  it("leaves from the closest coast and takes the shorter way, across the seam", () => {
    const { grid, game } = newGame(islands);
    const route = seaRoute(game, 2, grid.index(0, 1));
    expect(route?.from).toBe(grid.index(15, 1));
    expect(Array.from(route?.path ?? [])).toEqual([16, 17, 18, 19].map((x) => grid.index(x, 1)));
  });

  it("keeps to water, one tile at a time", () => {
    const { grid, game } = newGame(islands);
    const path = seaRoute(game, 1, grid.index(13, 2))?.path ?? new Int32Array();
    expect(path).toHaveLength(10);
    for (const tile of path) expect(game.terrain.kind(tile)).toBe(TileKind.Water);
    for (let i = 1; i < path.length; i++) {
      expect(grid.distance(path[i - 1] as number, path[i] as number)).toBe(1);
    }
  });

  it("finds nothing beyond B-BOAT-RANGE or across land", () => {
    const { grid, game } = newGame(islands, { boatRange: 4 });
    expect(seaRoute(game, 2, grid.index(0, 1))).toBeDefined();
    expect(seaRoute(game, 1, grid.index(13, 1))).toBeUndefined();
    // Player 2 reaches the lake only over land.
    const lake = newGame(["XXXXXX", "#11.#2", "XXXXXX"]);
    expect(seaRoute(lake.game, 1, lake.grid.index(4, 1))).toBeDefined();
    expect(seaRoute(lake.game, 2, lake.grid.index(0, 1))).toBeUndefined();
  });

  it("lists the coasts within reach by sea, closest first", () => {
    const { grid, game } = newGame(["XXXXXXXXXX", "#11....#2#", "#11..#...#", "XXXXXXXXXX"]);
    // A rock at (5, 2), then the other island, whose west end joins the player's across the seam.
    expect(reachableCoasts(game, 1, 10)).toEqual([
      grid.index(5, 2),
      grid.index(7, 1),
      grid.index(8, 1),
      grid.index(9, 2),
    ]);
    expect(reachableCoasts(game, 1, 1)).toEqual([grid.index(5, 2)]);
    expect(reachableCoasts(game, 1, 0)).toEqual([]);
  });
});

describe("transport ships (R-UNIT-02, R-ATTACK-09)", () => {
  it("sails B-BOAT-SPEED tiles per tick, lands, and attacks from the beach", () => {
    const { grid, game, ada, bea, run, embark } = newGame(islands);
    const target = grid.index(13, 1); // unowned coast of Bea's island
    game.territory.setOwner(target, 2);
    game.territory.setOwner(grid.index(13, 2), 2);
    expect(run([embark(1, target, 300)])).toBe(1);
    expect(ada.troops).toBeLessThan(1000);
    const [boat] = game.boats;
    expect(boat).toMatchObject({ id: 1, player: 1, target, troops: 300, step: 2 });
    for (let i = 0; i < 3; i++) run();
    expect(game.boats[0]?.step).toBe(8);
    run();
    expect(game.boats).toHaveLength(0);
    expect(game.territory.ownerOf(target)).toBe(1);
    expect(game.attacks).toEqual([expect.objectContaining({ player: 1, target: 2 })]);
    expect(bea.troops).toBeLessThan(1000);
  });

  it("keeps its beachhead while the attack from it goes on (R-ATTACK-08)", () => {
    const { grid, game, bea, run, embark } = newGame([
      "XXXXXXXXXXXXXXXXXXXX",
      "#11..........2##....",
      "#11..........22#....",
      "XXXXXXXXXXXXXXXXXXXX",
    ]);
    bea.troops = 30;
    const beach = grid.index(13, 1);
    run([embark(1, beach, 300)]);
    while (game.boats.length > 0) run();
    expect(game.territory.ownerOf(beach)).toBe(1);
    expect(game.attacks).toEqual([expect.objectContaining({ player: 1, target: 2 })]);
    // Bea takes the free land beside the beach, closing water and her own land around it.
    expect(
      run([{ player: 2, order: { type: "attack", target: grid.index(14, 1), troops: 20 } }]),
    ).toBe(1);
    expect(game.territory.ownerOf(grid.index(14, 1))).toBe(2);
    expect(game.territory.ownerOf(beach)).toBe(1);
  });

  it("attacks unowned land the same way", () => {
    const { grid, game, run, embark } = newGame(islands);
    run([embark(2, grid.index(0, 1), 200)]);
    run();
    expect(game.territory.ownerOf(grid.index(0, 1))).toBe(2);
    expect(game.attacks).toEqual([expect.objectContaining({ player: 2, target: NEUTRAL })]);
  });

  it("brings the troops home when the coast is already the player's", () => {
    const { grid, game, ada, run, embark } = newGame(islands);
    const target = grid.index(13, 1);
    run([embark(1, target, 300)]);
    game.territory.setOwner(target, 1);
    const before = ada.troops;
    for (let i = 0; i < 5; i++) run();
    expect(game.boats).toHaveLength(0);
    expect(ada.troops).toBeGreaterThanOrEqual(before + 300);
  });

  it("brings the troops home when the coast became an ally's on the way (R-DIPLO-02)", () => {
    const { grid, game, ada, run, embark } = newGame(islands);
    const target = grid.index(13, 1);
    game.territory.setOwner(target, 2);
    run([{ player: 2, order: { type: "ally", target: 1 } }]);
    // Ada sails, then accepts in the same turn: the ship is already at sea.
    run([embark(1, target, 300), { player: 1, order: { type: "ally", target: 2 } }]);
    expect(game.boats).toHaveLength(1);
    const before = ada.troops;
    for (let i = 0; i < 5; i++) run();
    expect(game.boats).toHaveLength(0);
    expect(game.territory.ownerOf(target)).toBe(2);
    expect(ada.troops).toBeGreaterThanOrEqual(before + 300);
  });

  it("loses the troops when they cannot pay for the beach", () => {
    const { grid, game, run, embark } = newGame(islands, { tileWeightTenths: [5000, 5000, 5000] });
    run([embark(2, grid.index(0, 1), 100)]);
    run();
    expect(game.boats).toHaveLength(0);
    expect(game.territory.ownerOf(grid.index(0, 1))).toBe(NEUTRAL);
    expect(game.attacks).toHaveLength(0);
  });

  it("sinks the ships of an eliminated player", () => {
    const { grid, game, ada, run, embark } = newGame(islands);
    run([embark(1, grid.index(13, 1), 300)]);
    ada.alive = false;
    run();
    expect(game.boats).toHaveLength(0);
  });

  it("refuses an embark order that no ship can carry out", () => {
    const { grid, game, ada, run, embark } = newGame(islands, { boatMax: 1 });
    const order = (target: number, troops = 10): Order => ({ type: "embark", target, troops });
    expect(orderError(game, ada, order(grid.index(4, 1)))).toBe("the tile cannot be owned");
    expect(orderError(game, ada, order(grid.index(1, 1)))).toBe("the target is already owned");
    expect(orderError(game, ada, order(grid.index(14, 1)))).toBe("ships can only land on a coast");
    expect(orderError(game, ada, order(grid.index(13, 1), 5000))).toBe("not enough troops");
    expect(orderError(game, ada, order(grid.index(13, 1), 0))).toBe("invalid troop count");
    run([embark(1, grid.index(13, 1), 10)]);
    expect(orderError(game, ada, order(grid.index(13, 2)))).toBe("too many ships at sea");
    // Ada's own island: no water route reaches it from her coast.
    const stranded = newGame(["XXXXXX", "#11.#2", "XXXXXX"]);
    expect(stranded.run([stranded.embark(2, stranded.grid.index(0, 1), 10)])).toBe(0);
    expect(stranded.game.boats).toHaveLength(0);
    expect(stranded.bea.troops).toBeGreaterThanOrEqual(1000);
  });

  it("waits for the spawn phase to end", () => {
    const { grid, game, ada } = newGame(islands, { spawnPhaseTicks: 10 });
    expect(orderError(game, ada, { type: "embark", target: grid.index(13, 1), troops: 1 })).toBe(
      "attacks start after the spawn phase",
    );
  });

  it("is part of the game state hash", () => {
    const a = newGame(islands);
    const b = newGame(islands);
    a.run([a.embark(1, a.grid.index(13, 1), 300)]);
    b.run();
    expect(a.game.hash()).not.toBe(b.game.hash());
  });
});

describe("coasts and land masses", () => {
  it("knows which land touches water and which land is connected", () => {
    const { grid, game } = newGame(["XXXXXXXX", "##...#X#", "XXXXXXXX"]);
    const { terrain } = game;
    expect(terrain.isCoast(grid.index(1, 1))).toBe(true);
    expect(terrain.isCoast(grid.index(0, 1))).toBe(false);
    expect(terrain.isCoast(grid.index(2, 1))).toBe(false);
    expect(terrain.isCoast(grid.index(6, 1))).toBe(false);
    // Across the seam, (7, 1) joins (0, 1); the impassable tile splits (5, 1) off.
    expect(terrain.landmassOf(grid.index(0, 1))).toBe(0);
    expect(terrain.landmassOf(grid.index(7, 1))).toBe(0);
    expect(terrain.landmassOf(grid.index(5, 1))).toBe(1);
    expect(terrain.landmassOf(grid.index(3, 1))).toBe(-1);
    expect(terrain.landmassOf(grid.index(6, 1))).toBe(-1);
  });

  it("tells the ocean, the largest body of water, from a lake (R-MAP-05)", () => {
    const { grid, game } = newGame(["XXXXXXXXXX", "#.##.....#", "##########", "XXXXXXXXXX"]);
    const { terrain } = game;
    // (1, 1) is a lake of one tile; (4, 1) to (8, 1) is the ocean.
    expect(terrain.isOceanCoast(grid.index(3, 1))).toBe(true);
    expect(terrain.isOceanCoast(grid.index(9, 1))).toBe(true);
    expect(terrain.isCoast(grid.index(2, 1))).toBe(true);
    expect(terrain.isOceanCoast(grid.index(2, 1))).toBe(false);
    expect(terrain.isOceanCoast(grid.index(0, 1))).toBe(false);
    expect(terrain.isOceanCoast(grid.index(5, 1))).toBe(false);
    expect(terrain.isOceanCoast(grid.index(5, 2))).toBe(true);
  });
});
