import {
  createGame,
  NEUTRAL,
  Random,
  reachableCoasts,
  Terrain,
  TileKind,
  TurnClock,
  WorldGrid,
  type Game,
  type GameRules,
} from "@frontfall/engine";

export interface SimulationOptions {
  readonly width: number;
  readonly height: number;
  readonly players: number;
  readonly seed: number;
  /** A real map to play on; without it, one is generated at the given size. */
  readonly terrain?: Terrain;
  /** Ticks each player waits between two attack orders. */
  readonly orderInterval: number;
  /** Special rules to play with (R-MODE-08); none when left out. */
  readonly rules?: Partial<GameRules>;
}

/**
 * Land made of rounded continents scattered over the sea, with hills and
 * mountains towards their centres. Not a real map, but it has coasts,
 * relief and several land masses, which is what the rules care about.
 */
export function generateTerrain(width: number, height: number, seed: number): Terrain {
  const grid = new WorldGrid(width, height);
  const random = new Random(seed);
  const depth = new Int32Array(grid.size);
  const continents = Math.max(3, Math.floor((width * height) / 40_000));
  for (let c = 0; c < continents; c++) {
    const centre = grid.index(random.nextInt(0, width), random.nextInt(2, height - 2));
    const radius = random.nextInt(Math.max(4, height >> 4), Math.max(5, height >> 2));
    for (const tile of grid.tilesWithin(centre, radius)) {
      const reach = radius - grid.distance(tile, centre);
      if (reach > (depth[tile] as number)) depth[tile] = reach;
    }
  }
  const kinds = new Uint8Array(grid.size);
  for (let tile = 0; tile < grid.size; tile++) {
    const y = grid.y(tile);
    const inland = depth[tile] as number;
    kinds[tile] =
      y === 0 || y === height - 1
        ? TileKind.Impassable
        : inland === 0
          ? TileKind.Water
          : inland > 24
            ? TileKind.Mountains
            : inland > 12
              ? TileKind.Hills
              : TileKind.Plains;
  }
  return new Terrain(grid, kinds);
}

/**
 * A whole game played by simple scripted players through a TurnClock, the way
 * the page will drive it. Each player in turn sends a third of its troops at
 * the land next to a random tile of its border, preferring unowned land.
 * Every other order goes for a neighbouring player instead. A player with
 * nothing left to take by land ships troops to one of the nearest coasts.
 */
export class Simulation {
  readonly game: Game;
  readonly clock: TurnClock;
  private readonly options: SimulationOptions;
  private readonly random: Random;
  private readonly around = new Int32Array(4);

  constructor(options: SimulationOptions) {
    this.options = options;
    const terrain = options.terrain ?? generateTerrain(options.width, options.height, options.seed);
    this.game = createGame({
      terrain,
      seed: options.seed,
      players: Array.from({ length: options.players }, (_, i) => ({
        id: i + 1,
        name: `Player ${String(i + 1)}`,
      })),
      ...(options.rules ? { rules: options.rules } : {}),
    });
    this.clock = new TurnClock(this.game);
    // Separate from the game's generator, so the script does not shift the rules' draws.
    this.random = new Random(options.seed ^ 0x5eed);
  }

  /** Queues this tick's orders and runs it. Returns the number of orders sent. */
  step(): number {
    const { game } = this;
    let sent = 0;
    if (game.phase === "play" && game.winner === undefined) {
      for (const player of game.players()) {
        if (!player.alive || (game.tick + player.id) % this.options.orderInterval !== 0) continue;
        const troops = Math.floor(player.troops / 3);
        if (troops <= 0) continue;
        // Every other order goes for a neighbour rather than unowned land, so empires meet.
        const preferEnemy = Math.floor(game.tick / this.options.orderInterval) % 2 === 1;
        const target = this.pickTarget(player.id, preferEnemy);
        if (target !== undefined) {
          this.clock.submit(player.id, { type: "attack", target, troops });
          sent++;
          continue;
        }
        const coasts = reachableCoasts(game, player.id, 8);
        const coast =
          coasts.find((tile) => (game.territory.ownerOf(tile) !== NEUTRAL) === preferEnemy) ??
          coasts[0];
        if (coast === undefined) continue;
        this.clock.submit(player.id, { type: "embark", target: coast, troops });
        sent++;
      }
    }
    this.clock.advance();
    return sent;
  }

  /** Land next to a few random border tiles, of the preferred kind if any is found. */
  private pickTarget(player: number, preferEnemy: boolean): number | undefined {
    const { territory, terrain } = this.game;
    const topology = terrain.topology;
    const borders = territory.borderCount(player);
    let fallback: number | undefined;
    for (let attempt = 0; attempt < 32 && borders > 0; attempt++) {
      const from = territory.borderTile(player, this.random.nextInt(0, borders));
      const count = topology.neighborsInto(from, this.around);
      for (let i = 0; i < count; i++) {
        const tile = this.around[i] as number;
        const owner = territory.ownerOf(tile);
        if (owner === player || !terrain.isOwnable(tile)) continue;
        if ((owner !== NEUTRAL) === preferEnemy) return tile;
        fallback ??= tile;
      }
    }
    return fallback;
  }
}
