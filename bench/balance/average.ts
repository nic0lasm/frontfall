import {
  capitalAim,
  divFloor,
  isAllied,
  MissileSize,
  missileCost,
  missileError,
  NEUTRAL,
  orderError,
  populationCap,
  reachableCoasts,
  StructureKind,
  structureCost,
  type Game,
  type Order,
  type Player,
} from "@frontfall/engine";

/** Seconds between two rounds of orders: a player who keeps an eye on the map. */
const EVERY_SECONDS = 2;

/** Share of its troops sent into free land, in %. */
const EXPAND_PERCENT = 50;

/** Troops, in % of its population cap, from which it opens a war. */
const READY_PERCENT = 60;

/**
 * Troops, in % of its population cap, it keeps home in a war: about where its
 * army grows fastest (R-ECO-02), as a player reading the population bar would.
 */
const KEEP_PERCENT = 35;

/** Its troops per tile, in % of the target's, from which a neighbour is worth attacking. */
const ODDS_PERCENT = 120;

/** Candidate start tiles weighed in the spawn phase. */
const SPAWN_CANDIDATES = 400;

/** Cities it owns before it builds a silo. */
const SILO_CITIES = 2;

/**
 * A stand-in for an average human player, stronger than the casual one: it
 * picks a start away from the nations, decides every 2 s, expands with half
 * its troops while land is free, attacks its weakest neighbour once its army
 * is ready and the odds favour it, answers whoever attacks it, builds cities,
 * a port, a fort facing an attacker, and, once rich, a silo, an air defense
 * when someone else has a silo, and light missiles at the cities of the
 * strongest player around. It never asks for an alliance.
 */
export class AveragePlayer {
  private readonly around = new Int32Array(4);
  private readonly every: number;

  constructor(
    private readonly game: Game,
    readonly id: number,
    /** Starts of the nations, which the player keeps away from. */
    private readonly avoid: readonly number[],
    private readonly seed: number,
  ) {
    this.every = EVERY_SECONDS * game.balance.ticksPerSecond;
  }

  /** The orders of this tick, to put in the turn. */
  orders(): Order[] {
    const { game } = this;
    if (game.tick === 0) return [{ type: "spawn", tile: this.spawnTile() }];
    const me = game.player(this.id);
    if (game.phase !== "play" || !me?.alive || game.tick % this.every !== 0) return [];
    const orders: Order[] = [];
    const build = this.build(me);
    if (build) orders.push(build);
    const missile = this.missile(me);
    if (missile) orders.push(missile);
    orders.push(...this.fight(me));
    return orders;
  }

  /** The candidate start, drawn from the seed, farthest from any nation, on a land mass of some size. */
  private spawnTile(): number {
    const { terrain } = this.game;
    const { topology } = terrain;
    let state = (this.seed * 2654435761) >>> 0 || 1;
    const next = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state;
    };
    let best = -1;
    let bestDistance = -1;
    for (let i = 0; i < SPAWN_CANDIDATES; i++) {
      const tile = next() % topology.size;
      if (!terrain.isOwnable(tile)) continue;
      let nearest = Number.MAX_SAFE_INTEGER;
      for (const start of this.avoid) {
        nearest = Math.min(nearest, topology.squaredDistance(tile, start));
      }
      // Some randomness among good spots, as a human does not measure.
      const score = nearest + (next() % 400);
      if (score > bestDistance) {
        best = tile;
        bestDistance = score;
      }
    }
    if (best >= 0) return best;
    let tile = 0;
    while (!terrain.isOwnable(tile)) tile++;
    return tile;
  }

  /** At most one building per round: fort under attack, then city, port, air defense, silo. */
  private build(me: Player): Order | undefined {
    const { game } = this;
    const start = me.start;
    if (start === undefined) return undefined;
    const attacker = this.mainAttacker();
    const can = (kind: StructureKind): boolean => me.gold >= structureCost(game, this.id, kind);
    if (attacker !== NEUTRAL && can(StructureKind.Fort)) {
      const front = this.borderWith(attacker);
      if (front >= 0) {
        const order = this.place(StructureKind.Fort, front, 20, true);
        if (order) return order;
      }
    }
    const count = (kind: StructureKind): number =>
      game.structures.filter((s) => s.player === this.id && s.kind === kind).length;
    if (can(StructureKind.City)) {
      const order = this.place(StructureKind.City, start, 60, false);
      if (order) return order;
    }
    if (
      count(StructureKind.City) >= 1 &&
      count(StructureKind.Port) === 0 &&
      can(StructureKind.Port)
    ) {
      const order = this.place(StructureKind.Port, start, 80, false);
      if (order) return order;
    }
    const threat = game.structures.some(
      (s) => s.kind === StructureKind.Silo && s.player !== this.id,
    );
    if (threat && count(StructureKind.AirDefense) === 0 && can(StructureKind.AirDefense)) {
      const order = this.place(StructureKind.AirDefense, start, 60, false);
      if (order) return order;
    }
    const light = missileCost(game, MissileSize.Light);
    if (
      count(StructureKind.Silo) === 0 &&
      count(StructureKind.City) >= SILO_CITIES &&
      me.gold >= structureCost(game, this.id, StructureKind.Silo) + light
    ) {
      return this.place(StructureKind.Silo, start, 60, false);
    }
    return undefined;
  }

  /** The first tile around `center` where `kind` may go, the closest first or, `back`, the farthest from the front first. */
  private place(
    kind: StructureKind,
    center: number,
    radius: number,
    back: boolean,
  ): Order | undefined {
    const { game } = this;
    const me = game.player(this.id) as Player;
    const tiles = [...game.terrain.topology.tilesWithin(center, radius)];
    if (back) tiles.reverse();
    for (const tile of tiles) {
      if (game.territory.ownerOf(tile) !== this.id) continue;
      const order: Order = { type: "build", structure: kind, tile };
      if (orderError(game, me, order) === undefined) return order;
    }
    return undefined;
  }

  /** A light missile at the city closest to its start of its attacker, or else of the largest other player. */
  private missile(me: Player): Order | undefined {
    const { game } = this;
    if (me.start === undefined || me.gold < missileCost(game, MissileSize.Light)) return undefined;
    let target = this.mainAttacker();
    if (target === NEUTRAL) {
      let most = 0;
      for (const p of game.players()) {
        if (p.id === this.id || !p.alive || isAllied(game, this.id, p.id)) continue;
        const tiles = game.territory.tileCount(p.id);
        if (tiles > most) {
          most = tiles;
          target = p.id;
        }
      }
    }
    if (target === NEUTRAL) return undefined;
    const topology = game.terrain.topology;
    let city = -1;
    let closest = 0;
    for (const s of game.structures) {
      if (s.player !== target) continue;
      if (s.kind !== StructureKind.City && s.kind !== StructureKind.Palace) continue;
      const distance = topology.squaredDistance(s.tile, me.start);
      if (city < 0 || distance < closest) {
        city = s.tile;
        closest = distance;
      }
    }
    if (city < 0 || missileError(game, me, city, MissileSize.Light) !== undefined) return undefined;
    return { type: "missile", target: city, size: MissileSize.Light };
  }

  /** Free land first; then the attacker, or the weakest neighbour once ready; else by sea. */
  private fight(me: Player): Order[] {
    const { game, around, id } = this;
    const { territory, terrain } = game;
    const tiles = Math.max(1, territory.tileCount(id));
    const cap = populationCap(game, me);
    const own = divFloor(me.troops, tiles);
    let neutral = -1;
    let enemy = -1;
    let enemyDensity = 0;
    const attacker = this.mainAttacker();
    let attackerTile = -1;
    const borders = territory.borderCount(id);
    for (let i = 0; i < borders; i++) {
      const count = terrain.topology.neighborsInto(territory.borderTile(id, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        const owner = territory.ownerOf(tile);
        if (owner === id || !game.usable(tile) || isAllied(game, id, owner)) continue;
        if (owner === NEUTRAL) {
          if (neutral < 0) neutral = tile;
          continue;
        }
        if (owner === attacker && attackerTile < 0) attackerTile = tile;
        const density = this.density(owner);
        if (enemy < 0 || density < enemyDensity) {
          enemy = tile;
          enemyDensity = density;
        }
      }
    }
    const orders: Order[] = [];
    const neutralCost = game.balance.neutralCost;
    if (neutral >= 0) {
      const troops = divFloor(me.troops * EXPAND_PERCENT, 100);
      if (troops >= neutralCost) orders.push({ type: "attack", target: neutral, troops });
    }
    const ready = me.troops * 100 >= cap * READY_PERCENT;
    const troops = me.troops - divFloor(cap * KEEP_PERCENT, 100);
    if (troops < neutralCost) return orders;
    // Answer an attacker it can beat, whatever the land left.
    if (attackerTile >= 0 && own * 100 >= this.density(attacker) * 100) {
      orders.push({ type: "attack", target: capitalAim(game, attackerTile), troops });
      return orders;
    }
    if (neutral >= 0 || !ready) return orders;
    if (enemy >= 0 && own * 100 >= enemyDensity * ODDS_PERCENT) {
      // In capital mode, a player who knows the rule heads for the capital (R-CAP-03).
      orders.push({ type: "attack", target: capitalAim(game, enemy), troops });
      return orders;
    }
    let coast = -1;
    let coastDensity = 0;
    for (const tile of reachableCoasts(game, id, 8, (_, distance) => distance >= 16)) {
      const owner = territory.ownerOf(tile);
      if (owner === NEUTRAL) {
        orders.push({ type: "embark", target: tile, troops });
        return orders;
      }
      if (isAllied(game, id, owner)) continue;
      const density = this.density(owner);
      if (coast < 0 || density < coastDensity) {
        coast = tile;
        coastDensity = density;
      }
    }
    if (coast >= 0 && own * 100 >= coastDensity * ODDS_PERCENT) {
      orders.push({ type: "embark", target: coast, troops });
    } else if (enemy >= 0 && me.troops * 100 >= cap * 90) {
      // A full army is wasted troops: fight the weakest neighbour anyway.
      orders.push({ type: "attack", target: capitalAim(game, enemy), troops });
    }
    return orders;
  }

  /** The player with the most troops in attacks on its land, or NEUTRAL. */
  private mainAttacker(): number {
    let attacker = NEUTRAL;
    let most = 0;
    const byPlayer = new Map<number, number>();
    for (const attack of this.game.attacks) {
      if (attack.target !== this.id) continue;
      const total = (byPlayer.get(attack.player) ?? 0) + attack.troops;
      byPlayer.set(attack.player, total);
      if (total > most) {
        attacker = attack.player;
        most = total;
      }
    }
    return attacker;
  }

  /** A tile of its own next to `owner`'s land, or -1. */
  private borderWith(owner: number): number {
    const { game, around, id } = this;
    const { territory, terrain } = game;
    for (let i = 0; i < territory.borderCount(id); i++) {
      const tile = territory.borderTile(id, i);
      const count = terrain.topology.neighborsInto(tile, around);
      for (let j = 0; j < count; j++) {
        if (territory.ownerOf(around[j] as number) === owner) return tile;
      }
    }
    return -1;
  }

  private density(owner: number): number {
    const player = this.game.player(owner);
    return divFloor(player?.troops ?? 0, Math.max(1, this.game.territory.tileCount(owner)));
  }
}
