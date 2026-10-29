import { captureCost, defenderLoss, NEUTRAL, type Game } from "@frontfall/engine";

/** How fights between players went over one game: how long, how fast, how costly. */
export interface CombatReport {
  /** Attacks of a player on another player that took at least one tile. */
  readonly attacks: number;
  /** Seconds each of those attacks lasted, median and 90th centile. */
  readonly durationMedian: number;
  readonly durationP90: number;
  /** Tiles each of them took per second, median and 90th centile. */
  readonly tilesPerSecondMedian: number;
  readonly tilesPerSecondP90: number;
  /**
   * Troops attackers paid for the land of other players, and troops the
   * owners lost with it, over the game, at the price of the moment
   * (encirclements and broken fronts counted at full price).
   */
  readonly attackerPaid: number;
  readonly defenderLost: number;
  /** For each player that lost land from 1000 tiles or more, the largest share of it lost within 10 s, in %. */
  readonly worstBlows: readonly number[];
  /** For each eliminated player, seconds from holding half their largest land to elimination. */
  readonly lastStands: readonly number[];
  /** The same two figures for player 1, the scripted player when there is one. */
  readonly playerWorstBlow?: number;
  readonly playerLastStand?: number;
  /** When player 1 took that worst blow, in seconds of the game, and the land they held 10 s before. */
  readonly playerWorstBlowAt?: number;
  readonly playerWorstBlowFrom?: number;
  /**
   * For each player a missile struck, the share of their land it took, in %,
   * and the share of those tiles they held again 30 s later.
   */
  readonly strikes: readonly { readonly share: number; readonly retaken: number }[];
}

interface Strike {
  readonly tick: number;
  readonly owner: number;
  readonly tiles: number[];
  readonly land: number;
}

interface Running {
  readonly first: number;
  last: number;
  tiles: number;
}

const centile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] as number;
};

/**
 * Watches every change of owner between two players, by wrapping the
 * territory's setOwner, and the attacks under way after each tick. Reads the
 * game only: the game plays the same, and hashes the same, with or without it.
 */
export class CombatLog {
  private readonly running = new Map<number, Running>();
  private readonly done: Running[] = [];
  /** Tiles taken this tick from `target` by `player`, keyed by player * 4096 + target. */
  private readonly takenThisTick = new Map<number, number>();
  /** Tiles of each player at each second, for the 10 s window. */
  private readonly history = new Map<number, number[]>();
  private readonly largest = new Map<number, number>();
  private readonly halfAt = new Map<number, number>();
  private readonly worst = new Map<number, number>();
  private readonly stands: number[] = [];
  private playerStand: number | undefined;
  private playerBlowAt = 0;
  private playerBlowFrom = 0;
  private paid = 0;
  private lost = 0;
  /** Land a player lost to nobody this tick, which only a missile does. */
  private readonly struckThisTick = new Map<number, number[]>();
  private readonly pending: Strike[] = [];
  private readonly strikes: { share: number; retaken: number }[] = [];

  constructor(private readonly game: Game) {
    const territory = game.territory;
    const setOwner = territory.setOwner.bind(territory);
    territory.setOwner = (tile: number, player: number): void => {
      const previous = territory.owners[tile] as number;
      if (previous !== NEUTRAL && player !== NEUTRAL && previous !== player) {
        const defender = game.player(previous);
        if (defender) {
          this.paid += captureCost(game, tile, defender);
          this.lost += defenderLoss(game, tile, defender);
        }
        const key = player * 4096 + previous;
        this.takenThisTick.set(key, (this.takenThisTick.get(key) ?? 0) + 1);
      } else if (previous !== NEUTRAL && player === NEUTRAL) {
        let tiles = this.struckThisTick.get(previous);
        if (!tiles) {
          tiles = [];
          this.struckThisTick.set(previous, tiles);
        }
        tiles.push(tile);
      }
      setOwner(tile, player);
    };
  }

  /** Call after each tick of play. */
  afterTick(): void {
    const { game } = this;
    const tick = game.tick;
    for (const [owner, tiles] of this.struckThisTick) {
      // A player losing their last tiles to nobody is eliminated, not struck: skip them.
      const land = game.territory.tileCount(owner) + tiles.length;
      if (tiles.length < land) this.pending.push({ tick, owner, tiles, land });
    }
    this.struckThisTick.clear();
    const later = 30 * game.balance.ticksPerSecond;
    while (this.pending.length > 0 && (this.pending[0] as Strike).tick + later <= tick) {
      const strike = this.pending.shift() as Strike;
      const held = strike.tiles.filter((t) => game.territory.owners[t] === strike.owner).length;
      this.strikes.push({
        share: (strike.tiles.length * 100) / strike.land,
        retaken: (held * 100) / strike.tiles.length,
      });
    }
    const live = new Set<number>();
    for (const attack of game.attacks) {
      if (attack.target === NEUTRAL) continue;
      live.add(attack.id);
      let run = this.running.get(attack.id);
      if (!run) {
        run = { first: tick, last: tick, tiles: 0 };
        this.running.set(attack.id, run);
      }
      run.last = tick;
      const key = attack.player * 4096 + attack.target;
      run.tiles += this.takenThisTick.get(key) ?? 0;
      this.takenThisTick.delete(key);
    }
    this.takenThisTick.clear();
    for (const [id, run] of this.running) {
      if (live.has(id)) continue;
      this.running.delete(id);
      if (run.tiles > 0) this.done.push(run);
    }

    const perSecond = game.balance.ticksPerSecond;
    if (tick % perSecond !== 0) return;
    const seconds = tick / perSecond;
    for (const p of game.players()) {
      const tiles = p.alive ? game.territory.tileCount(p.id) : 0;
      const largest = Math.max(this.largest.get(p.id) ?? 0, tiles);
      this.largest.set(p.id, largest);
      if (tiles * 2 >= largest) this.halfAt.set(p.id, seconds);
      let history = this.history.get(p.id);
      if (!history) {
        history = [];
        this.history.set(p.id, history);
      }
      if (history.length > 0 && (history.at(-1) as number) === 0) continue;
      history.push(tiles);
      if (tiles === 0) {
        const stand = seconds - (this.halfAt.get(p.id) ?? seconds);
        this.stands.push(stand);
        if (p.id === 1) this.playerStand = stand;
      }
      const before = history.length > 10 ? (history[history.length - 11] as number) : 0;
      // Small players, nations above all, fall in a breath whatever the pace: count from 1000 tiles.
      if (before >= 1000 && tiles < before) {
        const share = ((before - tiles) * 100) / before;
        if (share > (this.worst.get(p.id) ?? 0)) {
          this.worst.set(p.id, share);
          if (p.id === 1) {
            this.playerBlowAt = seconds;
            this.playerBlowFrom = before;
          }
        }
      }
    }
  }

  report(): CombatReport {
    const perSecond = this.game.balance.ticksPerSecond;
    const runs = [...this.done, ...[...this.running.values()].filter((r) => r.tiles > 0)];
    const durations = runs.map((r) => (r.last - r.first + 1) / perSecond);
    const speeds = runs.map((r) => (r.tiles * perSecond) / (r.last - r.first + 1));
    return {
      attacks: runs.length,
      durationMedian: centile(durations, 50),
      durationP90: centile(durations, 90),
      tilesPerSecondMedian: centile(speeds, 50),
      tilesPerSecondP90: centile(speeds, 90),
      attackerPaid: this.paid,
      defenderLost: this.lost,
      worstBlows: [...this.worst.values()],
      strikes: this.strikes,
      lastStands: this.stands,
      ...(this.worst.has(1) ? { playerWorstBlow: this.worst.get(1) as number } : {}),
      ...(this.playerStand === undefined ? {} : { playerLastStand: this.playerStand }),
      ...(this.worst.has(1)
        ? { playerWorstBlowAt: this.playerBlowAt, playerWorstBlowFrom: this.playerBlowFrom }
        : {}),
    };
  }
}

export { centile };
