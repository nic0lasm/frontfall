import { doctrinePercent, withDoctrine } from "./doctrines.ts";
import type { Balance } from "./balance.ts";
import { OperatorBonus } from "@frontfall/contracts";
import type { Game, Player } from "./game.ts";
import { OPERATOR_FACTOR } from "./modes.ts";
import { detPow, divFloor, isqrt, mulDiv, percentOf } from "./integer-math.ts";
import { DiplomacyError, isAllied, isTraitor, logEvent } from "./diplomacy.ts";
import { soldiers } from "./economy.ts";
import { capitalOf, capitalsStand, guardedByCapital } from "./capitals.ts";
import { LandmarkEffect, guardedByLandmark, heldLandmarks } from "./landmarks.ts";
import { PLAY_PHASE, defineOrder, tileError, type Refusal } from "./order-rules.ts";
import { spawnSettings } from "./spawn.ts";
import { uint } from "./state/codec.ts";
import { writable } from "./state/lists.ts";
import { SlotValues, partKey } from "./state/parts.ts";
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
}

/**
 * R-ATTACK-10: ticks in a row each attack has overwhelmed the front it
 * pushes on, by the attack's place in `game.attacks`; only in a game with
 * collapsing fronts. Read for every attack every tick, so kept dense.
 */
const PRESSURE = partKey<SlotValues>("fronts");

/** Ticks in a row `attack` has overwhelmed its front (R-ATTACK-10); always 0 in a game without collapsing fronts. */
export function pressureOf(game: Game, attack: Readonly<Attack>): number {
  const pressure = game.part(PRESSURE);
  const slot = pressure ? game.attacks.indexOf(attack) : -1;
  return pressure && slot >= 0 ? pressure.get(slot) : 0;
}

/** R-SPAWN-05: nobody attacks, nor lands, during the spawn phase. */
export const ATTACK_EARLY = "attacks start after the spawn phase";

/** Refusals of attack and retreat orders besides those of `targetError`, so that interfaces can tell them apart. */
export const AttackError = {
  Early: ATTACK_EARLY,
  /** The owner of the target tile is out of the game. */
  Fallen: "the target is out of the game",
  /** R-ATTACK-09: no land of the target touches the player's. */
  Border: "no border with the target: only ships reach it",
  /** R-ATTACK-06: no attack of the player's with troops left has the id. */
  Retreat: "no attack of yours under way with this id",
} as const;

/**
 * Why `player` cannot send `troops` against the owner of `target`, by land or
 * by sea, or undefined. The phase is checked before.
 */
export function targetError(
  game: Game,
  player: Player,
  target: number,
  troops: number,
): Refusal | undefined {
  const error = tileError(game, target);
  if (error) return error;
  if (!Number.isSafeInteger(troops) || troops < 1) return "invalid troop count";
  // R-ECO-07: workers stay at home.
  if (troops > soldiers(game, player)) return "not enough troops";
  if (game.territory.ownerOf(target) === player.id) return "the target is already owned";
  // R-DIPLO-02: an ally is attacked only after betraying them.
  if (isAllied(game, player.id, game.territory.ownerOf(target))) return DiplomacyError.Ally;
  return undefined;
}

/** Scratch space of `touches`, which never runs inside another call of itself. */
const touchAround = new Int32Array(4);

/** Whether any land of `target` touches the player's territory. */
function touches(game: Game, player: number, target: number): boolean {
  const { territory } = game;
  const topology = game.terrain.topology;
  const owners = territory.owners;
  const borders = territory.borderCount(player);
  for (let i = 0; i < borders; i++) {
    const count = topology.neighborsInto(territory.borderTile(player, i), touchAround);
    for (let j = 0; j < count; j++) {
      const tile = touchAround[j] as number;
      if (owners[tile] === target && game.terrain.isOwnable(tile)) return true;
    }
  }
  return false;
}

/**
 * R-ATTACK-01, R-ATTACK-09: `attack` sends troops against the owner of a
 * tile, joining the player's attack on them if one is under way. A target
 * that fell, or one without a border shared with the player (only ships
 * reach it), is refused.
 */
export const ATTACK_ORDER = defineOrder("attack", {
  phases: PLAY_PHASE,
  wrongPhase: ATTACK_EARLY,
  validate(game, player, order) {
    const error = targetError(game, player, order.target, order.troops);
    if (error) return error;
    const target = game.territory.ownerOf(order.target);
    if (target !== NEUTRAL && !game.player(target)?.alive) return AttackError.Fallen;
    // R-ATTACK-09: without a shared border, only ships can reach the target.
    if (!touches(game, player.id, target)) return AttackError.Border;
    return { aim: order.target, troops: order.troops, target };
  },
  execute(game, player, { aim, troops, target }) {
    const attacks = writable(game, "attacks");
    const existing = attacks.find((a) => a.player === player.id && a.target === target);
    const attack = existing ?? {
      id: game.nextAttackId,
      player: player.id,
      target,
      aim,
      troops: 0,
    };
    player.troops -= troops;
    attack.troops += troops;
    attack.aim = aim;
    if (!existing) {
      attacks.push(attack);
      game.part(PRESSURE)?.push(0);
      game.nextAttackId++;
    }
  },
});

/**
 * R-ATTACK-06: a player calls back one of their own attacks, losing part of
 * its troops. An attack that is not theirs, or has no troops left, is refused.
 */
export const RETREAT_ORDER = defineOrder("retreat", {
  phases: PLAY_PHASE,
  wrongPhase: ATTACK_EARLY,
  validate(game, player, order) {
    if (!Number.isSafeInteger(order.attack) || order.attack < 1) return "invalid attack id";
    const attack = writable(game, "attacks").find(
      (a) => a.id === order.attack && a.player === player.id,
    );
    return attack && attack.troops > 0 ? { attack } : AttackError.Retreat;
  },
  execute(game, player, { attack }) {
    player.troops += attack.troops - percentOf(attack.troops, game.balance.retreatPenaltyPercent);
    attack.troops = 0;
  },
});

/**
 * Expansion and attacks (R-ATTACK-01 to R-ATTACK-07). Troops leave the player
 * when the attack starts, take tiles along the shared border each tick, and
 * whatever is left returns to the player when the attack ends. Attacks under
 * way live in `game.attacks`.
 */
export function installAttacks(game: Game): void {
  const { territory, terrain, balance } = game;
  const topology = terrain.topology;
  const attacks = writable(game, "attacks");
  // Read directly in the loops below, past the checks of ownerOf().
  const owners = territory.owners;

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
  const pressure = collapsing
    ? game.addPart(PRESSURE, new SlotValues(game, () => game.attacks, uint))
    : undefined;
  const collapseFill = new BoundedFloodFill(topology);
  const nearForts: number[] = [];
  const attacksOf = new Map<number, number[]>();
  const ownAround = new Int32Array(4);

  /**
   * Plans every attack's front for this tick before any of them moves: up to
   * its speed in tiles of its target that touch the player's territory, the
   * closest to its aim first. One pass over each attacking player's border
   * serves all of their attacks and measures their fronts, which set their
   * speed (R-ATTACK-03); only the best few tiles are then kept, so a long
   * front costs one scan and no sort.
   */
  function planFronts(): void {
    attacksOf.clear();
    for (let a = 0; a < attacks.length; a++) {
      const attack = attacks[a] as Attack;
      (fronts[a] ??= []).length = 0;
      (frontPriorities[a] ??= []).length = 0;
      frontLengths[a] = 0;
      const alive = game.player(attack.player)?.alive === true;
      // The most an attack of this size can take, before its front is measured.
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
      const borders = territory.borderList(player);
      // A player has at most one attack per target: the common single attack needs no lookup.
      const only = own.length === 1 ? (own[0] as number) : -1;
      const onlyTarget = only < 0 ? -1 : (attacks[only] as Attack).target;
      for (let i = 0; i < borders.length; i++) {
        const count = topology.neighborsInto(borders[i] as number, around);
        for (let j = 0; j < count; j++) {
          const tile = around[j] as number;
          // Most neighbours of a border tile are the player's own: rule them out first.
          const owner = owners[tile] as number;
          if (owner === player || seen[tile] === scan) continue;
          let a = -1;
          if (only >= 0) {
            if (owner === onlyTarget) a = only;
          } else {
            for (let k = 0; k < own.length; k++) {
              if ((attacks[own[k] as number] as Attack).target === owner) {
                a = own[k] as number;
                break;
              }
            }
          }
          if (a < 0 || !game.terrain.isOwnable(tile)) continue;
          seen[tile] = scan;
          frontLengths[a] = (frontLengths[a] as number) + 1;
          consider(a, player, tile);
        }
      }
    }
    // The shortlist kept the best tiles an attack of its size could take; its front's pace keeps the first few.
    for (let a = 0; a < attacks.length; a++) {
      if (speeds[a] === 0) continue;
      speeds[a] = pace(a);
      const tiles = fronts[a] as number[];
      if (tiles.length > (speeds[a] as number)) {
        tiles.length = speeds[a] as number;
        (frontPriorities[a] as number[]).length = speeds[a] as number;
      }
    }
    if (collapsing) for (let a = 0; a < attacks.length; a++) overwhelming[a] = overwhelms(a);
  }

  /**
   * R-ATTACK-03: tiles an attack on a player takes this tick. At full
   * strength, troops of B-ATTACK-PACE-ODDS times the garrison facing them,
   * a share B-ATTACK-PACE of the front's length; a weaker attack in
   * proportion, at least one tile; never more than its size allows
   * (B-ATTACK-SPEED). Unowned land only knows the last limit.
   */
  function pace(a: number): number {
    const attack = attacks[a] as Attack;
    const most = speeds[a] as number;
    if (attack.target === NEUTRAL || balance.attackPacePercent === 0) return most;
    const defender = game.player(attack.target);
    const front = frontLengths[a] as number;
    if (!defender?.alive || front === 0) return most;
    const garrison = Math.max(1, defensePerTile(game, defender) * front);
    const full = Math.max(1, mulDiv(garrison, balance.attackPaceOddsTenths, 10));
    const strength = Math.min(attack.troops, full);
    // R-DOCTRINE: and the pace of the player's attacks.
    const doctrine = doctrinePercent(game, attack.player, "pace");
    const tiles = mulDiv(front * balance.attackPacePercent * doctrine, strength, full * 10_000);
    return Math.min(most, Math.max(1, tiles));
  }

  /**
   * Shortlists a tile of an attack's front by priority(), skipping the work
   * when even its best possible priority, with all four sides on the
   * player's land, could not make the full shortlist.
   */
  function consider(a: number, player: number, tile: number): void {
    const tiles = fronts[a] as number[];
    const distance = topology.squaredDistance(tile, (attacks[a] as Attack).aim);
    if (tiles.length === speeds[a] && balance.attackSpread >= 0) {
      // A tile only gets in with a rank below the last one's, or equal to it with a lower number.
      const last = (frontPriorities[a] as number[])[tiles.length - 1] as number;
      const bound = last + 4 * balance.attackSpread;
      if (bound >= 0 && distance >= (bound + 1) * (bound + 1)) return;
    }
    shortlist(a, tile, priority(player, tile, distance));
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
  function priority(player: number, tile: number, squaredDistance: number): number {
    let sides = 0;
    const count = topology.neighborsInto(tile, ownAround);
    for (let k = 0; k < count; k++) if (owners[ownAround[k] as number] === player) sides++;
    return isqrt(squaredDistance) - balance.attackSpread * sides;
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

  const tileCost = (tile: number, defender: Player | undefined, attack: Attack): number =>
    captureCost(game, tile, defender, attack.player, attack.troops);

  game.onOrder(RETREAT_ORDER);
  game.onOrder(ATTACK_ORDER);

  game.onTick(() => {
    if (game.phase !== "play") return;
    cancelOpposingAttacks(attacks);
    planFronts();
    for (let a = 0; a < attacks.length; a++) {
      advance(a, attacks[a] as Attack, fronts[a] as number[], overwhelming[a] === true);
    }
    // Troops of a finished attack went back to its player in finish(); a fallen player's are lost.
    for (let i = attacks.length - 1; i >= 0; i--) {
      const attack = attacks[i] as Attack;
      if (attack.troops <= 0 || !game.player(attack.player)?.alive) {
        attacks.splice(i, 1);
        pressure?.remove(i);
      }
    }
  });

  /** Takes the tiles planned for this tick for the attack at `slot`; an attack that cannot go on is marked done. */
  function advance(
    slot: number,
    attack: Attack,
    tiles: readonly number[],
    overwhelms: boolean,
  ): void {
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
      if (owners[tile] !== attack.target) continue;
      const cost = tileCost(tile, defender, attack);
      if (attack.troops < cost) {
        finish(attack);
        break;
      }
      attack.troops -= cost;
      if (defender) defender.troops -= defenderLoss(game, tile, defender);
      territory.setOwner(tile, attack.player);
      captured.push(tile);
    }
    if (pressure && defender) {
      const ticks = overwhelms && captured.length > 0 ? pressure.get(slot) + 1 : 0;
      pressure.set(slot, ticks >= balance.collapseBuildupTicks ? 0 : ticks);
      if (ticks >= balance.collapseBuildupTicks) {
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
        if (owners[tile] === defender.id && game.terrain.isOwnable(tile)) start = tile;
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
          owners[tile] === defender.id &&
          game.terrain.isOwnable(tile) &&
          topology.squaredDistance(tile, tip) <= depth * depth &&
          !holds(tile),
        limit,
      );
      if (size <= 0) continue;
      const first = captured.length;
      for (const tile of collapseFill.tiles()) {
        const cost = Math.max(
          1,
          mulDiv(tileCost(tile, defender, attack), balance.collapseCostPercent, 100),
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
        const defender = owners[start] as number;
        if (defender === attacker || defender === NEUTRAL) continue;
        // R-DIPLO-02: an ally's pocket stays theirs.
        if (isAllied(game, attacker, defender)) continue;
        if (examined[start] === examination) continue;
        pocketDefender = defender;
        pocketAttacker = attacker;
        const size = pocketFill.fill(start, inPocket, balance.encircleMaxTiles);
        // A pocket that is all the defender has left is fought for, not taken at once.
        if (size > 0 && size < territory.tileCount(defender) && !holds(defender)) {
          for (const pocket of pocketFill.tiles()) territory.setOwner(pocket, attacker);
        } else {
          for (const open of pocketFill.reached()) examined[open] = examination;
        }
      }
    }
  }

  // The two sides of the pocket fill under way, read by inPocket(), which is made once rather than per fill.
  let pocketDefender = NEUTRAL;
  let pocketAttacker = NEUTRAL;

  /** Whether a tile belongs to the pocket being filled; stops the fill at any way out. */
  function inPocket(candidate: number): boolean {
    const owner = owners[candidate] as number;
    if (owner === pocketDefender) {
      if (examined[candidate] !== examination) return true;
      pocketFill.stop(); // joins a region already known to be open
      return false;
    }
    // Any land not held by the attacker means the region still has a way out.
    if (owner !== pocketAttacker && terrain.isOwnable(candidate)) pocketFill.stop();
    return false;
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

/** Tile prices are worked out in thousandths of a troop, then rounded to whole troops tile by tile. */
const MILLI = 1000;

/**
 * Whole troops for a price of `milli` thousandths on `tile`: the fraction
 * rounds up on that share of tiles, picked by a fixed hash of the tile, so a
 * price of 1.6 costs 2 troops on six tiles in ten and every client agrees.
 */
function wholeTroops(tile: number, milli: number): number {
  const whole = Math.floor(milli / MILLI);
  const pick = (Math.imul(tile + 1, 0x9e3779b1) >>> 0) % MILLI;
  return whole + (pick < milli - whole * MILLI ? 1 : 0);
}

/** The cheapest land there is: a plains tile nobody holds, in whole troops, rounded up. */
export function cheapestTile(balance: Balance): number {
  return Math.ceil((balance.tileWeightTenths[0] * balance.neutralSharePercent) / 1000);
}

const largeShares = new WeakMap<Game, Map<number, number>>();

/**
 * R-ATTACK-04: how far a territory of `tiles` is along the way to a huge one,
 * from 0 to 1, halfway at B-LARGE-MID: a logistic of the land's logarithm.
 */
function largeShare(game: Game, tiles: number): number {
  if (tiles <= 0) return 0;
  let shares = largeShares.get(game);
  if (!shares) {
    shares = new Map();
    largeShares.set(game, shares);
  }
  let share = shares.get(tiles);
  if (share === undefined) {
    if (shares.size > 50_000) shares.clear();
    share = 1 / (1 + detPow(game.balance.largeMidTiles / tiles, 2.5));
    shares.set(tiles, share);
  }
  return share;
}

/**
 * Troops it costs `attacker` to take one tile with an attack of
 * `attackTroops` (R-ATTACK-03, R-ATTACK-04, R-MAP-06). Unowned land costs a
 * share of the tile's weight. A player's tile costs its weight times the odds
 * the attack faces (the defender's soldiers per attacking troop, held between
 * B-ODDS-MIN and B-ODDS-MAX; even odds when the attack is not known) times a
 * base, lowered for huge territories on either side, plus the defender's
 * soldiers on each tile. It costs more within reach of one of the defender's
 * forts (R-BUILD-03), of their capital (R-CAP-02) or of a fortress landmark
 * they hold (R-LAND-02): the strongest applies, not all. An attacker holding
 * an assault landmark pays less (R-LAND-02).
 */
export function captureCost(
  game: Game,
  tile: number,
  defender: Player | undefined,
  attacker: number = NEUTRAL,
  attackTroops?: number,
): number {
  const { balance, terrain, territory } = game;
  const kind = terrain.kind(tile);
  const weight =
    balance.tileWeightTenths[kind === TileKind.Mountains ? 2 : kind === TileKind.Hills ? 1 : 0] *
    (MILLI / 10);
  const bot = game.bots.has(attacker);
  let cost: number;
  if (!defender) {
    cost = mulDiv(weight, bot ? balance.botNeutralSharePercent : balance.neutralSharePercent, 100);
  } else {
    const defending = soldiers(game, defender);
    const tiles = territory.tileCount(defender.id);
    const odds = Math.min(
      balance.oddsMaxPercent / 100,
      Math.max(balance.oddsMinPercent / 100, defending / Math.max(1, attackTroops ?? defending)),
    );
    const sizes =
      (1 - (balance.largeAttackerPercent / 100) * largeShare(game, territory.tileCount(attacker))) *
      (1 - (balance.largeDefenderPercent / 100) * largeShare(game, tiles));
    const density = tiles === 0 ? 0 : defending / tiles;
    cost = Math.floor(
      (weight *
        odds *
        (balance.lossBaseThousandths * sizes + balance.lossDensityThousandths * density)) /
        MILLI,
    );
    // Bots hold their land loosely against players and nations.
    if (game.bots.has(defender.id) && !bot) cost = mulDiv(cost, balance.botDefensePercent, 100);
  }
  const assaults = heldLandmarks(game, attacker, LandmarkEffect.Assault);
  if (assaults > 0) {
    cost = mulDiv(cost, Math.max(0, 100 - assaults * balance.landmarkAssaultPercent), 100);
  }
  // R-UNIT-06: land under fallout costs more to take, whoever held it.
  if (game.irradiated(tile)) cost = mulDiv(cost, balance.falloutCostPercent, 100);
  if (!defender) return wholeTroops(tile, cost);
  const fort = fortified(game, tile, defender.id) ? balance.fortStrengthPercent : 100;
  const capital = guardedByCapital(game, tile, defender.id) ? balance.capitalStrengthPercent : 100;
  const landmark = guardedByLandmark(game, tile, defender.id)
    ? balance.landmarkFortressPercent
    : 100;
  const strength = Math.max(fort, capital, landmark);
  if (strength !== 100) cost = mulDiv(cost, strength, 100);
  // R-DOCTRINE: what the attacker's doctrine makes the land cost them.
  cost = withDoctrine(game, attacker, "attackerLoss", cost);
  // R-MODE-09: the operator's defense bonus doubles the price of their land.
  if (game.hasBonus(defender.id, OperatorBonus.Defense)) cost *= OPERATOR_FACTOR;
  // R-DIPLO-04: a traitor's land is cheaper to take while the mark lasts.
  if (isTraitor(game, defender)) cost = mulDiv(cost, balance.traitorDefensePercent, 100);
  let troops = wholeTroops(tile, cost);
  // R-CAP-02: the capital itself holds a share of its owner's whole army.
  if (capitalsStand(game) && capitalOf(game, defender.id) === tile) {
    troops += percentOf(soldiers(game, defender), balance.capitalGarrisonPercent);
  }
  return troops;
}

/** Troops a defender loses with one of their tiles: their density, less within reach of their forts (R-BUILD-03). */
export function defenderLoss(game: Game, tile: number, defender: Player): number {
  let loss = troopsPerTile(game, defender);
  if (fortified(game, tile, defender.id)) loss = mulDiv(loss, game.balance.fortLossPercent, 100);
  // R-DOCTRINE: and what the defender's doctrine spares them.
  loss = withDoctrine(game, defender.id, "defenderLoss", loss);
  return Math.min(defender.troops, loss);
}

/** A defender's soldiers spread over their land, which the fronts weigh an attack against (R-ECO-07). */
export function defensePerTile(game: Game, defender: Player): number {
  const tiles = game.territory.tileCount(defender.id);
  return tiles === 0 ? 0 : divFloor(soldiers(game, defender), tiles);
}

/** A defender's troops, workers included, spread over their land: what they lose with each tile taken. */
export function troopsPerTile(game: Game, defender: Player): number {
  const tiles = game.territory.tileCount(defender.id);
  return tiles === 0 ? 0 : divFloor(defender.troops, tiles);
}
