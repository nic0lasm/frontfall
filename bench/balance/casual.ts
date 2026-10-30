import {
  cheapestTile,
  divFloor,
  isAllied,
  NEUTRAL,
  orderError,
  populationCap,
  reachableCoasts,
  StructureKind,
  type Game,
  type Order,
} from "@frontfall/engine";

/** Seconds between two orders of the scripted player. */
const EVERY_SECONDS = 5;

/** Share of its troops each order sends, in %: the interface's default ratio. */
const RATIO_PERCENT = 30;

/** How often and how hard a scripted player orders. */
export interface CasualPace {
  readonly everySeconds: number;
  readonly ratioPercent: number;
  /** The order waits until its troops fill this share of the population cap: what the population bar teaches. */
  readonly minFillPercent?: number;
}

/**
 * A stand-in for a casual human player, the one balance.md measures against:
 * an order every 5 s with 30 % of its troops, at free land first, then at
 * its least dense neighbour, then by ship to a free or less dense coast; and
 * a city near its start whenever its gold allows. It starts on the first
 * free tile from `start`, and never asks for an alliance.
 */
export class CasualPlayer {
  private readonly around = new Int32Array(4);
  private readonly every: number;

  constructor(
    private readonly game: Game,
    readonly id: number,
    private readonly start: number,
    private readonly pace: CasualPace = {
      everySeconds: EVERY_SECONDS,
      ratioPercent: RATIO_PERCENT,
    },
  ) {
    this.every = pace.everySeconds * game.balance.ticksPerSecond;
  }

  /** The orders of this tick, to put in the turn. */
  orders(): Order[] {
    const { game } = this;
    if (game.tick === 0) return [{ type: "spawn", tile: this.spawnTile() }];
    const me = game.player(this.id);
    if (game.phase !== "play" || !me?.alive || game.tick % this.every !== 0) return [];
    const orders: Order[] = [];
    const city = this.city();
    if (city) orders.push(city);
    // Troops grow with the army and peak at about 40 % of the cap: an order that empties the army only slows it.
    const fill = this.pace.minFillPercent ?? 0;
    if (me.troops * 100 < populationCap(game, me) * fill) return orders;
    const troops = divFloor(me.troops * this.pace.ratioPercent, 100);
    if (troops >= cheapestTile(game.balance)) {
      const order = this.attack(troops);
      if (order) orders.push(order);
    }
    return orders;
  }

  private spawnTile(): number {
    const { terrain } = this.game;
    let tile = this.start;
    while (!terrain.isOwnable(tile)) tile = (tile + 1) % terrain.topology.size;
    return tile;
  }

  private city(): Order | undefined {
    const { game } = this;
    const me = game.player(this.id);
    const centre = me?.start;
    if (centre === undefined) return undefined;
    for (const tile of game.terrain.topology.tilesWithin(centre, 40)) {
      const order: Order = { type: "build", structure: StructureKind.City, tile };
      if (orderError(game, me as NonNullable<typeof me>, order) === undefined) return order;
    }
    return undefined;
  }

  private attack(troops: number): Order | undefined {
    const { game, around, id } = this;
    const { territory, terrain } = game;
    let enemy = -1;
    let enemyDensity = 0;
    const borders = territory.borderCount(id);
    for (let i = 0; i < borders; i++) {
      const count = terrain.topology.neighborsInto(territory.borderTile(id, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        const owner = territory.ownerOf(tile);
        if (owner === id || !game.terrain.isOwnable(tile) || isAllied(game, id, owner)) continue;
        if (owner === NEUTRAL) return { type: "attack", target: tile, troops };
        const density = this.density(owner);
        if (enemy < 0 || density < enemyDensity) {
          enemy = tile;
          enemyDensity = density;
        }
      }
    }
    if (enemy >= 0) return { type: "attack", target: enemy, troops };
    let coast = -1;
    let coastDensity = 0;
    for (const tile of reachableCoasts(game, id, 8, (_, distance) => distance >= 16)) {
      const owner = territory.ownerOf(tile);
      if (owner === NEUTRAL) return { type: "embark", target: tile, troops };
      if (isAllied(game, id, owner)) continue;
      const density = this.density(owner);
      if (coast < 0 || density < coastDensity) {
        coast = tile;
        coastDensity = density;
      }
    }
    return coast < 0 ? undefined : { type: "embark", target: coast, troops };
  }

  private density(owner: number): number {
    const player = this.game.player(owner);
    return divFloor(player?.troops ?? 0, Math.max(1, this.game.territory.tileCount(owner)));
  }
}
