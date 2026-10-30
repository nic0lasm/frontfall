import {
  cheapestTile,
  divFloor,
  allyError,
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

/** The three simulated players of the campaign. */
export type ProfileName = "beginner" | "nico" | "veteran";

/** A scripted player: its orders for this tick, and how many it knows will be refused. */
export interface ProfilePlayer {
  orders(): Order[];
  /** Orders it sent that the rules refuse: misclicks, as a UX signal. */
  readonly refused: number;
  /** Orders it sent in all. */
  readonly sent: number;
}

/** A small seeded generator, so a campaign game replays exactly. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = (seed * 2654435761) >>> 0 || 1;
  }
  next(): number {
    this.state ^= this.state << 13;
    this.state >>>= 0;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    this.state >>>= 0;
    return this.state / 0x100000000;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }
}

/** Behaviour that distinguishes one profile from another. */
export interface Style {
  /** Seconds between two rounds of orders, drawn between these. */
  readonly everySeconds: readonly [number, number];
  /** Share of the army each attack sends, in %, drawn from these. */
  readonly ratios: readonly number[];
  /** Chance, in %, that a round is a misclick: own land, water or an ally. */
  readonly misclickPercent: number;
  /** Chance, in %, that a round is skipped: the player is reading, looking away. */
  readonly idlePercent: number;
  /** Chance, in %, to attack the strongest neighbour rather than the weakest. */
  readonly bravePercent: number;
  /** Waits for the army to fill this share of the cap before a war, 0 not to wait. */
  readonly waitFillPercent: number;
  /** Share of the cap, in %, it keeps home: what the population bar teaches. */
  readonly reservePercent: number;
  readonly buildsCities: boolean;
  readonly buildsPort: boolean;
  readonly buildsFort: boolean;
  readonly usesBoats: boolean;
  readonly asksAlliances: boolean;
  /** Share of the people at work, in %, or undefined to leave the slider alone. */
  readonly workShare?: number;
}

export const STYLES: Record<ProfileName, Style> = {
  // Ignores the guide: random slider, misclicks, looks away, no boat, no ally.
  beginner: {
    everySeconds: [5, 14],
    ratios: [10, 20, 30, 50, 100],
    misclickPercent: 20,
    idlePercent: 25,
    bravePercent: 35,
    waitFillPercent: 0,
    reservePercent: 0,
    buildsCities: true,
    buildsPort: false,
    buildsFort: false,
    usesBoats: false,
    asksAlliances: false,
  },
  // Nico: fast, easy to normal, boats, alliances, builds a lot.
  nico: {
    everySeconds: [1, 3],
    ratios: [30, 40, 50],
    misclickPercent: 3,
    idlePercent: 5,
    bravePercent: 10,
    waitFillPercent: 30,
    reservePercent: 20,
    buildsCities: true,
    buildsPort: true,
    buildsFort: true,
    usesBoats: true,
    asksAlliances: true,
    workShare: 50,
  },
  // A veteran: reads the population bar, waits, picks fights it wins.
  veteran: {
    everySeconds: [1, 2],
    ratios: [35, 45, 55],
    misclickPercent: 0,
    idlePercent: 0,
    bravePercent: 0,
    waitFillPercent: 55,
    reservePercent: 30,
    buildsCities: true,
    buildsPort: true,
    buildsFort: true,
    usesBoats: true,
    asksAlliances: true,
    workShare: 60,
  },
};

/** One configurable human stand-in; the style decides who it plays like. */
export class StyledPlayer implements ProfilePlayer {
  refused = 0;
  sent = 0;
  private readonly around = new Int32Array(4);
  private readonly rng: Rng;
  private nextRound = 0;
  private lastAsk = -1e9;
  private worked = false;

  constructor(
    private readonly game: Game,
    private readonly id: number,
    private readonly style: Style,
    seed: number,
    /** Starts of the nations, which the nico and veteran profiles keep away from. */
    private readonly avoid: readonly number[],
  ) {
    this.rng = new Rng(seed * 31 + 7);
  }

  orders(): Order[] {
    const { game } = this;
    const tps = game.balance.ticksPerSecond;
    if (game.tick === 0) return this.track([{ type: "spawn", tile: this.spawnTile() }]);
    const me = game.player(this.id);
    if (game.phase !== "play" || !me?.alive || game.tick < this.nextRound) return [];
    const [lo, hi] = this.style.everySeconds;
    this.nextRound = game.tick + Math.round((lo + this.rng.next() * (hi - lo)) * tps);
    if (this.rng.int(100) < this.style.idlePercent) return [];
    const out: Order[] = [];
    if (this.style.workShare !== undefined && !this.worked) {
      this.worked = true;
      out.push({ type: "work", share: this.style.workShare });
    }
    const build = this.build(me);
    if (build) out.push(build);
    if (this.style.asksAlliances) {
      const ask = this.alliance(me);
      if (ask) out.push(ask);
    }
    out.push(...this.fight(me));
    return this.track(out);
  }

  private track(orders: Order[]): Order[] {
    const me = this.game.player(this.id);
    for (const order of orders) {
      this.sent++;
      if (me && this.game.tick > 0 && orderError(this.game, me, order) !== undefined)
        this.refused++;
    }
    return orders;
  }

  private spawnTile(): number {
    const { terrain } = this.game;
    const { topology } = terrain;
    let best = -1;
    let bestScore = -1;
    const careful = this.style.waitFillPercent > 0;
    for (let i = 0; i < 300; i++) {
      const tile = this.rng.int(topology.size);
      if (!terrain.isOwnable(tile)) continue;
      let nearest = 1e12;
      if (careful)
        for (const s of this.avoid) nearest = Math.min(nearest, topology.squaredDistance(tile, s));
      const score = careful ? nearest : this.rng.next();
      if (score > bestScore) {
        best = tile;
        bestScore = score;
      }
    }
    if (best >= 0) return best;
    let tile = 0;
    while (!terrain.isOwnable(tile)) tile++;
    return tile;
  }

  private build(me: Player): Order | undefined {
    const { game, style } = this;
    const start = me.start;
    if (start === undefined) return undefined;
    const can = (kind: StructureKind): boolean => me.gold >= structureCost(game, this.id, kind);
    const count = (kind: StructureKind): number =>
      game.structures.filter((s) => s.player === this.id && s.kind === kind).length;
    const place = (kind: StructureKind): Order | undefined => {
      for (const tile of game.terrain.topology.tilesWithin(start, 60)) {
        if (game.territory.ownerOf(tile) !== this.id) continue;
        const order: Order = { type: "build", structure: kind, tile };
        if (orderError(game, me, order) === undefined) return order;
      }
      return undefined;
    };
    if (style.buildsFort && this.underAttack() && can(StructureKind.Fort)) {
      const order = place(StructureKind.Fort);
      if (order) return order;
    }
    if (style.buildsCities && can(StructureKind.City) && this.rng.int(100) < 70)
      return place(StructureKind.City);
    if (
      style.buildsPort &&
      count(StructureKind.Port) === 0 &&
      count(StructureKind.City) >= 1 &&
      can(StructureKind.Port)
    ) {
      return place(StructureKind.Port);
    }
    return undefined;
  }

  private underAttack(): boolean {
    return this.game.attacks.some((a) => a.target === this.id);
  }

  /** Asks the strongest other player for an alliance, at most every 40 s. */
  private alliance(me: Player): Order | undefined {
    const { game } = this;
    if (game.tick - this.lastAsk < 40 * game.balance.ticksPerSecond) return undefined;
    let best = -1;
    let most = 0;
    for (const p of game.players()) {
      if (p.id === this.id || !p.alive || isAllied(game, this.id, p.id)) continue;
      const tiles = game.territory.tileCount(p.id);
      if (tiles > most && allyError(game, me, p.id) === undefined) {
        most = tiles;
        best = p.id;
      }
    }
    if (best < 0) return undefined;
    this.lastAsk = game.tick;
    return { type: "ally", target: best };
  }

  private density(owner: number): number {
    return divFloor(
      this.game.player(owner)?.troops ?? 0,
      Math.max(1, this.game.territory.tileCount(owner)),
    );
  }

  private fight(me: Player): Order[] {
    const { game, around, id, style, rng } = this;
    const { territory, terrain } = game;
    const cap = populationCap(game, me);
    const ratio = rng.pick(style.ratios);
    const spare = Math.max(0, me.troops - divFloor(cap * style.reservePercent, 100));
    const troops = divFloor(spare * ratio, 100);
    if (troops < cheapestTile(game.balance)) return [];
    if (rng.int(100) < style.misclickPercent) return [this.misclick(troops)];
    let neutral = -1;
    let weak = -1;
    let weakD = 0;
    let strong = -1;
    let strongD = 0;
    const borders = territory.borderCount(id);
    for (let i = 0; i < borders; i++) {
      const count = terrain.topology.neighborsInto(territory.borderTile(id, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        const owner = territory.ownerOf(tile);
        if (owner === id || !terrain.isOwnable(tile) || isAllied(game, id, owner)) continue;
        if (owner === NEUTRAL) {
          if (neutral < 0) neutral = tile;
          continue;
        }
        const d = this.density(owner);
        if (weak < 0 || d < weakD) [weak, weakD] = [tile, d];
        if (strong < 0 || d > strongD) [strong, strongD] = [tile, d];
      }
    }
    if (neutral >= 0) return [{ type: "attack", target: neutral, troops }];
    const ready = me.troops * 100 >= cap * style.waitFillPercent;
    if (!ready && !this.underAttack()) return [];
    const foe = rng.int(100) < style.bravePercent ? strong : weak;
    if (foe >= 0) return [{ type: "attack", target: foe, troops }];
    if (!style.usesBoats) return [];
    for (const tile of reachableCoasts(game, id, 8, (_, distance) => distance >= 16)) {
      const owner = territory.ownerOf(tile);
      if (owner === NEUTRAL || !isAllied(game, id, owner))
        return [{ type: "embark", target: tile, troops }];
    }
    return [];
  }

  /** A click on the wrong thing: own land, or the sea. The rules must refuse it without harm. */
  private misclick(troops: number): Order {
    const { game, rng } = this;
    const topology = game.terrain.topology;
    for (let i = 0; i < 20; i++) {
      const tile = rng.int(topology.size);
      const wrong =
        rng.int(2) === 0 ? !game.terrain.isOwnable(tile) : game.territory.ownerOf(tile) === this.id;
      if (wrong) return { type: "attack", target: tile, troops };
    }
    return { type: "attack", target: 0, troops };
  }
}
