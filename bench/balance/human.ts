import {
  cheapestTile,
  divFloor,
  isAllied,
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
import { startAwayFrom } from "./average.ts";

/** How a human player of some practice plays, the values the bench tunes against. */
export interface HumanStyle {
  /** Seconds between two looks at the map, each with at most one attack. */
  readonly everySeconds: number;
  /** Share of its soldiers an expansion sends, in %: the attack ratio it leaves the slider on. */
  readonly ratioPercent: number;
  /** It sends nothing below this share of its cap: troops grow fastest at about 40 % (R-ECO-02). */
  readonly keepPercent: number;
  /** It turns on a player only past this share of its cap ... */
  readonly warPercent: number;
  /** ... and with this % of the target's troops at least. */
  readonly oddsPercent: number;
  /** Seconds of play during which it asks any neighbour for an alliance; later only stronger ones. */
  readonly allySeconds: number;
}

/** A player getting the hang of the genre: a look every 3 s, a 30 % slider, alliances in the first 5 min. */
export const INTERMEDIATE: HumanStyle = {
  everySeconds: 3,
  ratioPercent: 30,
  keepPercent: 40,
  warPercent: 60,
  oddsPercent: 150,
  allySeconds: 300,
};

/**
 * A stand-in for a human player, written from how the genre is played: it
 * picks a start away from the nations; takes free land with its slider
 * while its army stays near the size where it grows fastest; builds a city
 * as soon as its gold allows, a port once it has a city, and a fort facing
 * whoever attacks it; asks its neighbours for alliances, any early on and
 * stronger ones later, and renews them; once the
 * free land is gone, eats the city-states around it for their land and their
 * gold; answers an attacker with at least what comes at it; and turns on a
 * neighbour only with the odds well on its side, by sea when no land front
 * is open. It sends no missiles.
 */
export class HumanPlayer {
  private readonly around = new Int32Array(4);
  private readonly every: number;

  constructor(
    private readonly game: Game,
    readonly id: number,
    /** Starts of the nations, which it keeps away from. */
    private readonly avoid: readonly number[],
    private readonly seed: number,
    private readonly style: HumanStyle = INTERMEDIATE,
  ) {
    this.every = style.everySeconds * game.balance.ticksPerSecond;
  }

  /** The orders of this tick, to put in the turn. */
  orders(): Order[] {
    const { game } = this;
    if (game.tick === 0) {
      return [{ type: "spawn", tile: startAwayFrom(game, this.avoid, this.seed) }];
    }
    const me = game.player(this.id);
    if (game.phase !== "play" || !me?.alive || game.tick % this.every !== 0) return [];
    const orders: Order[] = [];
    const build = this.build(me);
    if (build) orders.push(build);
    const ally = this.ally(me);
    if (ally) orders.push(ally);
    const attack = this.attack(me);
    if (attack) orders.push(attack);
    return orders;
  }

  /** A fort facing its attacker, else a port once it has a city, else a city. */
  private build(me: Player): Order | undefined {
    const { game } = this;
    if (me.start === undefined) return undefined;
    const can = (kind: StructureKind): boolean => me.gold >= structureCost(game, this.id, kind);
    const attacker = this.attacker();
    if (attacker !== NEUTRAL && can(StructureKind.Fort)) {
      const front = this.borderWith(attacker);
      if (front >= 0) {
        const order = this.place(StructureKind.Fort, front, 6);
        if (order) return order;
      }
    }
    const count = (kind: StructureKind): number =>
      game.structures.filter((s) => s.player === this.id && s.kind === kind).length;
    // Ports pay for themselves in trade within a minute: one for every city, while it has coast.
    if (count(StructureKind.City) >= count(StructureKind.Port) && can(StructureKind.Port)) {
      const order = this.place(StructureKind.Port);
      if (order) return order;
    }
    if (can(StructureKind.City)) return this.place(StructureKind.City);
    return undefined;
  }

  /** A tile of its own where `kind` may go: near its start first, then anywhere along its land. */
  private place(kind: StructureKind, center?: number, radius = 60): Order | undefined {
    const { game } = this;
    const me = game.player(this.id) as Player;
    const fits = (tile: number): Order | undefined => {
      if (game.territory.ownerOf(tile) !== this.id) return undefined;
      const order: Order = { type: "build", structure: kind, tile };
      return orderError(game, me, order) === undefined ? order : undefined;
    };
    const around = center ?? me.start;
    if (around !== undefined) {
      for (const tile of game.terrain.topology.tilesWithin(around, radius)) {
        const order = fits(tile);
        if (order) return order;
      }
    }
    if (center !== undefined) return undefined;
    // Its land far from the start: a sample of its border, stepping inland.
    const { territory, terrain } = game;
    const borders = territory.borderCount(this.id);
    const stride = Math.max(1, Math.floor(borders / 64));
    for (let i = 0; i < borders; i += stride) {
      for (const tile of terrain.topology.tilesWithin(territory.borderTile(this.id, i), 8)) {
        const order = fits(tile);
        if (order) return order;
      }
    }
    return undefined;
  }

  /**
   * A renewal of an alliance about to run out, or a request to a neighbour
   * it is not allied with, the one with the most troops first: early on to
   * anyone, later only to those stronger than itself.
   */
  private ally(me: Player): Order | undefined {
    const { game } = this;
    const played = (game.tick - game.balance.spawnPhaseTicks) / game.balance.ticksPerSecond;
    let best: Order | undefined;
    let most = -1;
    for (const owner of this.neighbours()) {
      if (game.bots.has(owner)) continue;
      const order: Order = { type: "ally", target: owner };
      if (orderError(game, me, order) !== undefined) continue;
      const troops = game.player(owner)?.troops ?? 0;
      // A renewal the rules allow now comes first, while the ally could hurt it:
      // a weaker ally is left to lapse once the free land runs out, to be eaten next.
      if (isAllied(game, this.id, owner)) {
        if (played <= this.style.allySeconds || troops * 100 >= me.troops * 80) return order;
        continue;
      }
      if (played > this.style.allySeconds && troops <= me.troops) continue;
      if (troops > most) {
        best = order;
        most = troops;
      }
    }
    return best;
  }

  private attack(me: Player): Order | undefined {
    const { game, style } = this;
    const cap = populationCap(game, me);
    const keep = divFloor(cap * style.keepPercent, 100);
    const cheapest = cheapestTile(game.balance);
    const spare = Math.max(0, me.troops - keep);
    const slider = Math.min(spare, divFloor(me.troops * style.ratioPercent, 100));

    // Answer an attacker: troops sent back at them cancel theirs first (R-ATTACK-07),
    // so it sends at least what comes at it, and what it can spare on top.
    const attacker = this.attacker();
    if (attacker !== NEUTRAL) {
      const tile = this.borderWith(attacker);
      const incoming = this.incoming(attacker);
      const back = Math.min(
        me.troops - divFloor(cap, 10),
        Math.max(incoming + divFloor(incoming, 10), spare),
      );
      if (tile >= 0 && back >= cheapest) return { type: "attack", target: tile, troops: back };
      return undefined;
    }
    if (slider < cheapest) return undefined;
    const { neutral, city, enemy } = this.scan();
    if (neutral >= 0) return { type: "attack", target: neutral, troops: slider };
    if (city >= 0) return { type: "attack", target: city, troops: slider };
    const coasts = reachableCoasts(game, this.id, 8, (_, distance) => distance >= 16);
    // Free land overseas, while the slider fills a ship.
    for (const tile of coasts) {
      if (game.territory.ownerOf(tile) === NEUTRAL) {
        return { type: "embark", target: tile, troops: slider };
      }
    }
    if (me.troops * 100 < cap * style.warPercent) return undefined;
    // A full army grows no more: then any neighbour with fewer troops is worth it.
    const odds = me.troops * 100 >= cap * 90 ? 100 : style.oddsPercent;
    const beatable = (owner: number): boolean =>
      me.troops * 100 > (game.player(owner)?.troops ?? 0) * odds;
    if (enemy >= 0 && beatable(game.territory.ownerOf(enemy))) {
      return { type: "attack", target: enemy, troops: spare };
    }
    for (const tile of coasts) {
      const owner = game.territory.ownerOf(tile);
      if (owner === this.id || isAllied(game, this.id, owner)) continue;
      if (game.bots.has(owner) || beatable(owner)) {
        return { type: "embark", target: tile, troops: spare };
      }
    }
    return undefined;
  }

  /** Free land along its border, a city-state's tile, and a tile of the neighbour with the fewest troops. */
  private scan(): { neutral: number; city: number; enemy: number } {
    const { game, around, id } = this;
    const { territory, terrain } = game;
    let neutral = -1;
    let city = -1;
    let enemy = -1;
    let fewest = 0;
    for (let i = 0; i < territory.borderCount(id); i++) {
      const count = terrain.topology.neighborsInto(territory.borderTile(id, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        const owner = territory.ownerOf(tile);
        if (owner === id || !terrain.isOwnable(tile) || isAllied(game, id, owner)) continue;
        if (owner === NEUTRAL) {
          if (neutral < 0) neutral = tile;
          continue;
        }
        if (game.bots.has(owner)) {
          if (city < 0) city = tile;
          continue;
        }
        const troops = game.player(owner)?.troops ?? 0;
        if (enemy < 0 || troops < fewest) {
          enemy = tile;
          fewest = troops;
        }
      }
    }
    return { neutral, city, enemy };
  }

  /** The living players along its border, city-states included. */
  private neighbours(): number[] {
    const { game, around, id } = this;
    const { territory, terrain } = game;
    const found = new Set<number>();
    for (let i = 0; i < territory.borderCount(id); i++) {
      const count = terrain.topology.neighborsInto(territory.borderTile(id, i), around);
      for (let j = 0; j < count; j++) {
        const owner = territory.ownerOf(around[j] as number);
        if (owner !== id && owner !== NEUTRAL) found.add(owner);
      }
    }
    return [...found].sort((a, b) => a - b);
  }

  /** The player with the most troops in attacks on its land, or NEUTRAL. */
  private attacker(): number {
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

  /** Troops in `owner`'s attacks on its land. */
  private incoming(owner: number): number {
    let total = 0;
    for (const attack of this.game.attacks) {
      if (attack.target === this.id && attack.player === owner) total += attack.troops;
    }
    return total;
  }

  /** A tile of `owner` next to its land, or -1. */
  private borderWith(owner: number): number {
    const { game, around, id } = this;
    const { territory, terrain } = game;
    for (let i = 0; i < territory.borderCount(id); i++) {
      const count = terrain.topology.neighborsInto(territory.borderTile(id, i), around);
      for (let j = 0; j < count; j++) {
        if (territory.ownerOf(around[j] as number) === owner) return around[j] as number;
      }
    }
    return -1;
  }
}
