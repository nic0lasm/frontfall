import type { Game, Player } from "./game.ts";
import { divFloor, isqrt, mulDiv, percentOf } from "./integer-math.ts";
import { isAllied, isTraitor, logEvent } from "./diplomacy.ts";
import { soldiers } from "./economy.ts";
import { capitalsStand, guardedByCapital } from "./capitals.ts";
import { spawnSettings } from "./spawn.ts";
import { fortRadius, fortified, isReady, StructureKind } from "./structures.ts";
import { TileKind } from "./terrain.ts";
import { BoundedFloodFill } from "./territory/bounded-flood-fill.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** A wave of troops pushing into the land of one opponent, or into unowned land. */
export interface Attack {
  readonly id: number;
  readonly player: number;
  /** Owner of the land under attack: a player id, or NEUTRAL. */
  readonly target: number;
  /** Tile the player aimed at; the front advances towards it first. */
  aim: number;
  troops: number;
  /**
   * Ticks in a row this attack has overwhelmed the front it pushes on
   * (R-ATTACK-10); always 0 in a game without collapsing fronts.
   */
  pressure: number;
}

/**
 * Expansion and attacks (R-ATTACK-01 to R-ATTACK-07). Troops leave the player
 * when the attack starts, take tiles along the shared border each tick, and
 * whatever is left returns to the player when the attack ends. Attacks under
 * way live in `game.attacks`.
 */
export function installAttacks(game: Game): void {
  const { territory, terrain, balance } = game;
  const topology = terrain.topology;
  const attacks = game.attacks;

  // Scratch space reused every tick: tiles already listed as candidates in the current scan.
  const seen = new Uint32Array(topology.size);
  let scan = 0;
  const around = new Int32Array(4);
  const pocketFill = new BoundedFloodFill(topology);
  const nextToCapture = new Int32Array(4);
  // Defender tiles already found in an open or oversized region during the current check.
  const examined = new Uint32Array(topology.size);
  let examination = 0;
  const captured: number[] = [];
  const heldBy: number[] = [];
  const aroundAim = new Int32Array(4);

  // Each attack's front for the current tick: tiles to take, closest to its aim first.
  const fronts: number[][] = [];
  const frontPriorities: number[][] = [];
  const speeds: number[] = [];
  // R-ATTACK-10: tiles of its target each attack touches, and whether it overwhelms them.
  const frontLengths: number[] = [];
  const overwhelming: boolean[] = [];
  const collapsing = game.rules.collapsingFronts;
  const collapseFill = new BoundedFloodFill(topology);
  const nearForts: number[] = [];
  const attacksOf = new Map<number, number[]>();
  const ownAround = new Int32Array(4);

  /**
   * Plans every attack's front for this tick before any of them moves: up to
   * its speed in tiles of its target that touch the player's territory, the
   * closest to its aim first. One pass over each attacking player's border
   * serves all of their attacks, and only the best few tiles are kept, so a
   * long front costs one scan and no sort.
   */
  function planFronts(): void {
    attacksOf.clear();
    for (let a = 0; a < attacks.length; a++) {
      const attack = attacks[a] as Attack;
      (fronts[a] ??= []).length = 0;
      (frontPriorities[a] ??= []).length = 0;
      frontLengths[a] = 0;
      const alive = game.player(attack.player)?.alive === true;
      speeds[a] =
        alive && attack.troops > 0
          ? 1 + divFloor(isqrt(attack.troops), balance.attackSpeedDivisor)
          : 0;
      if (speeds[a] === 0) continue;
      const own = attacksOf.get(attack.player);
      if (own) own.push(a);
      else attacksOf.set(attack.player, [a]);
    }
    // Map iteration follows insertion, which follows the attack list: the same on every client.
    for (const [player, own] of attacksOf) {
      scan++;
      const borders = territory.borderCount(player);
      for (let i = 0; i < borders; i++) {
        const count = topology.neighborsInto(territory.borderTile(player, i), around);
        for (let j = 0; j < count; j++) {
          const tile = around[j] as number;
          if (seen[tile] === scan) continue;
          const owner = territory.ownerOf(tile);
          if (owner === player || !game.usable(tile)) continue;
          const a = own.find((index) => (attacks[index] as Attack).target === owner);
          if (a === undefined) continue;
          seen[tile] = scan;
          frontLengths[a] = (frontLengths[a] as number) + 1;
          shortlist(a, tile, priority(player, tile, (attacks[a] as Attack).aim));
        }
      }
    }
    if (collapsing) for (let a = 0; a < attacks.length; a++) overwhelming[a] = overwhelms(a);
  }

  /**
   * R-ATTACK-10: whether an attack's troops are at least B-COLLAPSE-ODDS
   * times the garrison facing it, the defender's soldiers per tile over every
   * tile of theirs the attacker touches. Judged before any attack moves.
   */
  function overwhelms(a: number): boolean {
    const attack = attacks[a] as Attack;
    if (attack.target === NEUTRAL || speeds[a] === 0) return false;
    const defender = game.player(attack.target);
    if (!defender?.alive) return false;
    const garrison = defensePerTile(game, defender) * (frontLengths[a] as number);
    return attack.troops * 10 >= balance.collapseOddsTenths * Math.max(1, garrison);
  }

  /**
   * Lower comes first: the straight-line distance to the aim, less
   * B-ATTACK-SPREAD for each side the tile shares with the player's land.
   * Tiles in the hollows of the front catch up with its tip, so an attack
   * spreads as a wedge towards its aim instead of a thin line.
   */
  function priority(player: number, tile: number, aim: number): number {
    let sides = 0;
    const count = topology.neighborsInto(tile, ownAround);
    for (let k = 0; k < count; k++)
      if (territory.ownerOf(ownAround[k] as number) === player) sides++;
    return isqrt(topology.squaredDistance(tile, aim)) - balance.attackSpread * sides;
  }

  /** Inserts a tile into an attack's front, kept sorted by priority then tile and cut at its speed. */
  function shortlist(a: number, tile: number, rank: number): void {
    const tiles = fronts[a] as number[];
    const ranks = frontPriorities[a] as number[];
    const limit = speeds[a] as number;
    let at = tiles.length;
    while (
      at > 0 &&
      ((ranks[at - 1] as number) > rank ||
        ((ranks[at - 1] as number) === rank && (tiles[at - 1] as number) > tile))
    ) {
      at--;
    }
    if (at >= limit) return;
    tiles.splice(at, 0, tile);
    ranks.splice(at, 0, rank);
    if (tiles.length > limit) {
      tiles.pop();
      ranks.pop();
    }
  }

  /** Whether any land of `target` touches the player's territory. */
  function touches(player: number, target: number): boolean {
    const borders = territory.borderCount(player);
    for (let i = 0; i < borders; i++) {
      const count = topology.neighborsInto(territory.borderTile(player, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        if (territory.ownerOf(tile) === target && game.usable(tile)) return true;
      }
    }
    return false;
  }

  const tileCost = (tile: number, defender: Player | undefined): number =>
    captureCost(game, tile, defender);

  // R-ATTACK-06: a player calls back one of their own attacks, losing part of its troops.
  game.onOrder((_, player, order) => {
    if (order.type !== "retreat") return false;
    const attack = attacks.find((a) => a.id === order.attack && a.player === player.id);
    if (!attack || attack.troops <= 0) return false;
    player.troops += attack.troops - percentOf(attack.troops, balance.retreatPenaltyPercent);
    attack.troops = 0;
    return true;
  });

  game.onOrder((_, player, order) => {
    if (order.type !== "attack") return false;
    const target = territory.ownerOf(order.target);
    if (target !== NEUTRAL && !game.player(target)?.alive) return false;
    const existing = attacks.find((a) => a.player === player.id && a.target === target);
    const attack = existing ?? {
      id: game.nextAttackId,
      player: player.id,
      target,
      aim: order.target,
      troops: 0,
      pressure: 0,
    };
    // R-ATTACK-09: without a shared border, only ships can reach the target.
    if (!touches(player.id, target)) return false;
    player.troops -= order.troops;
    attack.troops += order.troops;
    attack.aim = order.target;
    if (!existing) {
      attacks.push(attack);
      game.nextAttackId++;
    }
    return true;
  });

  game.onTick(() => {
    if (game.phase !== "play") return;
    cancelOpposingAttacks(attacks);
    planFronts();
    for (let a = 0; a < attacks.length; a++) {
      advance(attacks[a] as Attack, fronts[a] as number[], overwhelming[a] === true);
    }
    // Troops of a finished attack went back to its player in finish(); a fallen player's are lost.
    for (let i = attacks.length - 1; i >= 0; i--) {
      const attack = attacks[i] as Attack;
      if (attack.troops <= 0 || !game.player(attack.player)?.alive) attacks.splice(i, 1);
    }
  });

  /** Takes the tiles planned for this tick; an attack that cannot go on is marked done. */
  function advance(attack: Attack, tiles: readonly number[], overwhelms: boolean): void {
    const attacker = game.player(attack.player);
    const defender = attack.target === NEUTRAL ? undefined : game.player(attack.target);
    if (!attacker?.alive || attack.troops <= 0) return;
    if (tiles.length === 0) {
      finish(attack);
      return;
    }
    captured.length = 0;
    for (const tile of tiles) {
      // Another attack, or an encirclement, may have taken it earlier in the tick.
      if (territory.ownerOf(tile) !== attack.target) continue;
      const cost = tileCost(tile, defender);
      if (attack.troops < cost) {
        finish(attack);
        break;
      }
      attack.troops -= cost;
      if (defender) defender.troops -= defenderLoss(game, tile, defender);
      territory.setOwner(tile, attack.player);
      captured.push(tile);
    }
    if (collapsing && defender) {
      attack.pressure = overwhelms && captured.length > 0 ? attack.pressure + 1 : 0;
      if (attack.pressure >= balance.collapseBuildupTicks) {
        attack.pressure = 0;
        collapse(attack, defender);
      }
    }
    captureEnclosedPockets(attack.player);
  }

  /**
   * R-ATTACK-10: the front breaks behind the tile taken this tick closest to
   * the aim. The defender's land joined to it, within B-COLLAPSE-DEPTH of
   * that tip and out of reach of their forts, falls at once, nearest first,
   * for B-COLLAPSE-COST of its usual price, as long as the attack can pay.
   * Land cut off by the breach then falls by encirclement (R-ATTACK-08).
   */
  function collapse(attack: Attack, defender: Player): void {
    const depth = collapseDepth(game);
    for (const tip of captured) {
      const count = topology.neighborsInto(tip, around);
      let start = -1;
      for (let j = 0; j < count && start < 0; j++) {
        const tile = around[j] as number;
        if (territory.ownerOf(tile) === defender.id && game.usable(tile)) start = tile;
      }
      if (start < 0) continue;
      // Forts close enough to cover some of the stretch; the others cannot.
      // The stretch is a disc, but forts reach in steps along the grid: its corners are √2 × depth away.
      const reach = isqrt(2 * depth * depth) + 1 + fortRadius(game);
      nearForts.length = 0;
      for (const structure of game.structures) {
        if (
          structure.kind === StructureKind.Fort &&
          structure.player === defender.id &&
          territory.ownerOf(structure.tile) === defender.id &&
          isReady(game, structure) &&
          topology.distance(structure.tile, tip) <= reach
        ) {
          nearForts.push(structure.tile);
        }
      }
      const radius = fortRadius(game);
      const holds = (tile: number): boolean =>
        nearForts.some((fort) => topology.distance(fort, tile) <= radius);
      const limit = (2 * depth + 1) * (2 * depth + 1);
      const size = collapseFill.fill(
        start,
        (tile) =>
          territory.ownerOf(tile) === defender.id &&
          game.usable(tile) &&
          topology.squaredDistance(tile, tip) <= depth * depth &&
          !holds(tile),
        limit,
      );
      if (size <= 0) continue;
      const first = captured.length;
      for (const tile of collapseFill.tiles()) {
        const cost = Math.max(
          1,
          mulDiv(tileCost(tile, defender), balance.collapseCostPercent, 100),
        );
        if (attack.troops < cost) break;
        attack.troops -= cost;
        defender.troops -= defenderLoss(game, tile, defender);
        territory.setOwner(tile, attack.player);
        captured.push(tile);
      }
      if (captured.length > first) {
        logEvent(game, {
          tick: game.tick,
          type: "collapsed",
          a: attack.player,
          b: defender.id,
          tile: tip,
        });
      }
      return;
    }
  }

  /**
   * R-ATTACK-08: once an attack has taken this tick's tiles, any piece of
   * another player's land next to them that is now enclosed by the attacker
   * alone goes to the attacker, whoever the attack was aimed at. A region
   * found open, or too large, is not walked again for the other tiles of the
   * same tick: a long front costs one fill per region, not one per tile.
   */
  function captureEnclosedPockets(attacker: number): void {
    examination++;
    // Attacks against the attacker, by player then aim: their troops hold the land next to their aim.
    heldBy.length = 0;
    for (const attack of attacks) {
      if (attack.target === attacker && attack.troops > 0) heldBy.push(attack.player, attack.aim);
    }
    for (const tile of captured) {
      const count = topology.neighborsInto(tile, nextToCapture);
      for (let i = 0; i < count; i++) {
        const start = nextToCapture[i] as number;
        const defender = territory.ownerOf(start);
        if (defender === attacker || defender === NEUTRAL) continue;
        // R-DIPLO-02: an ally's pocket stays theirs.
        if (isAllied(game, attacker, defender)) continue;
        if (examined[start] === examination) continue;
        const size = pocketFill.fill(
          start,
          (candidate) => {
            const owner = territory.ownerOf(candidate);
            if (owner === defender) {
              if (examined[candidate] !== examination) return true;
              pocketFill.stop(); // joins a region already known to be open
              return false;
            }
            // Any land not held by the attacker means the region still has a way out.
            if (owner !== attacker && terrain.isOwnable(candidate)) pocketFill.stop();
            return false;
          },
          balance.encircleMaxTiles,
        );
        if (size > 0 && !holds(defender)) {
          for (const pocket of pocketFill.tiles()) territory.setOwner(pocket, attacker);
        } else {
          for (const open of pocketFill.reached()) examined[open] = examination;
        }
      }
    }
  }

  /**
   * Whether the pocket just filled lies next to the aim of one of the
   * defender's attacks on the attacker: troops fighting from there hold it,
   * a beachhead above all.
   */
  function holds(defender: number): boolean {
    for (let h = 0; h < heldBy.length; h += 2) {
      if (heldBy[h] !== defender) continue;
      const aim = heldBy[h + 1] as number;
      if (pocketFill.contains(aim)) return true;
      const count = topology.neighborsInto(aim, aroundAim);
      for (let k = 0; k < count; k++) if (pocketFill.contains(aroundAim[k] as number)) return true;
    }
    return false;
  }

  /** Ends an attack at the next sweep, returning its troops to the player. */
  function finish(attack: Attack): void {
    const player = game.player(attack.player);
    if (player?.alive) player.troops += attack.troops;
    attack.troops = 0;
  }
}

/** B-COLLAPSE-DEPTH on this map: a length on a map of 2^19 tiles, grown with the side like the spawn radius. */
export function collapseDepth(game: Game): number {
  const { collapseDepth: depth, spawnRadius } = game.balance;
  return Math.max(depth, mulDiv(depth, spawnSettings(game).radius, spawnRadius));
}

/** R-ATTACK-07: two attacks between the same players in opposite directions fight each other first. */
function cancelOpposingAttacks(attacks: Attack[]): void {
  for (const attack of attacks) {
    if (attack.target === NEUTRAL || attack.troops <= 0) continue;
    const opposing = attacks.find(
      (other) =>
        other.player === attack.target && other.target === attack.player && other.troops > 0,
    );
    if (!opposing) continue;
    const clash = Math.min(attack.troops, opposing.troops);
    attack.troops -= clash;
    opposing.troops -= clash;
  }
}

/**
 * Troops it costs to take one tile (R-ATTACK-03, R-ATTACK-04, R-MAP-06),
 * more within reach of one of the defender's forts (R-BUILD-03) or of their
 * capital (R-CAP-02): the stronger of the two applies, not both.
 */
export function captureCost(game: Game, tile: number, defender: Player | undefined): number {
  const { balance, terrain } = game;
  const kind = terrain.kind(tile);
  const relief =
    balance.reliefCostTenths[kind === TileKind.Mountains ? 2 : kind === TileKind.Hills ? 1 : 0];
  const density = defender ? defensePerTile(game, defender) : 0;
  const base = balance.neutralCost + mulDiv(density, balance.defenseDensityTenths, 10);
  let cost = Math.max(1, mulDiv(base, relief, 10));
  if (!defender) return cost;
  const fort = fortified(game, tile, defender.id) ? balance.fortStrengthPercent : 100;
  const capital = guardedByCapital(game, tile, defender.id) ? balance.capitalStrengthPercent : 100;
  const strength = Math.max(fort, capital);
  if (strength !== 100) cost = mulDiv(cost, strength, 100);
  // R-DIPLO-04: a traitor's land is cheaper to take while the mark lasts.
  if (isTraitor(game, defender)) cost = mulDiv(cost, balance.traitorDefensePercent, 100);
  // R-CAP-02: the capital itself holds a share of its owner's whole army.
  if (capitalsStand(game) && defender.capital === tile) {
    cost += percentOf(soldiers(defender), balance.capitalGarrisonPercent);
  }
  return Math.max(1, cost);
}

/** Troops a defender loses with one of their tiles: their density, less within reach of their forts (R-BUILD-03). */
export function defenderLoss(game: Game, tile: number, defender: Player): number {
  let loss = troopsPerTile(game, defender);
  if (fortified(game, tile, defender.id)) loss = mulDiv(loss, game.balance.fortLossPercent, 100);
  return Math.min(defender.troops, loss);
}

/** A defender's soldiers spread over their land: what an attacker pays for on top of the land's price (R-ECO-07). */
export function defensePerTile(game: Game, defender: Player): number {
  const tiles = game.territory.tileCount(defender.id);
  return tiles === 0 ? 0 : divFloor(soldiers(defender), tiles);
}

/** A defender's troops, workers included, spread over their land: what they lose with each tile taken. */
export function troopsPerTile(game: Game, defender: Player): number {
  const tiles = game.territory.tileCount(defender.id);
  return tiles === 0 ? 0 : divFloor(defender.troops, tiles);
}
