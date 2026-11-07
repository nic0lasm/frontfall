import { isAllied, logEvent } from "./diplomacy.ts";
import type { Game, Player } from "./game.ts";
import { mulDiv, percentOf } from "./integer-math.ts";
import { spawnSettings } from "./spawn.ts";
import { tileOrNone } from "./state/codec.ts";
import { PlayerValues, RecordList, partKey } from "./state/parts.ts";
import { CAPITAL_FALL_RECORD } from "./state/records.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** A capital that fell (R-CAP-03) or was razed (R-CAP-04). */
export interface CapitalFall {
  readonly tick: number;
  /** Player whose capital it was. */
  readonly player: number;
  /** Player who took it; 0 when it was razed and moved. */
  readonly by: number;
  /** Tile the capital stood on. */
  readonly tile: number;
}

/** The tile of each player's capital, -1 for none; only in capital mode. */
const CAPITALS = partKey<PlayerValues>("capitals");
/** Capitals taken or razed, oldest first; only in capital mode. */
const CAPITAL_FALLS = partKey<RecordList<CapitalFall>>("capital falls");

const NO_FALLS: readonly Readonly<CapitalFall>[] = Object.freeze([]);

/** The tile of a player's capital (R-CAP-01): undefined before play, after it fell, and in a game without capitals. */
export function capitalOf(game: Game, player: number): number | undefined {
  const tile = game.part(CAPITALS)?.get(player) ?? -1;
  return tile < 0 ? undefined : tile;
}

/** Capitals taken or razed, oldest first (R-CAP-03, R-CAP-04); none in a game without capitals. */
export function capitalFalls(game: Game): readonly Readonly<CapitalFall>[] {
  return game.part(CAPITAL_FALLS)?.entries ?? NO_FALLS;
}

/**
 * Radius around a capital, in tiles, within which attackers pay
 * B-CAPITAL-STRENGTH (R-CAP-02): B-CAPITAL-RADIUS on a map of 2^19 tiles,
 * growing with the side of larger maps like the spawn radius.
 */
export function capitalRadius(game: Game): number {
  const { spawnRadius, capitalRadius: radius } = game.balance;
  return Math.max(radius, mulDiv(radius, spawnSettings(game).radius, spawnRadius));
}

/** Distance from a capital, in tiles, within which an enemy front threatens it (R-CAP-05), scaled like the radius. */
export function capitalAlertDistance(game: Game): number {
  const { spawnRadius, capitalAlert } = game.balance;
  return Math.max(capitalAlert, mulDiv(capitalAlert, spawnSettings(game).radius, spawnRadius));
}

/** R-CAP-06: whether capitals can fall yet; before, a capital taken only moves. */
export function capitalsStand(game: Game): boolean {
  const { spawnPhaseTicks, capitalGraceTicks } = game.balance;
  return game.rules.capitals && game.tick >= spawnPhaseTicks + capitalGraceTicks;
}

/** R-CAP-02: whether the tile lies within the radius of its owner's capital. */
export function guardedByCapital(game: Game, tile: number, owner: number): boolean {
  if (!game.rules.capitals || owner === NEUTRAL) return false;
  const capital = capitalOf(game, owner);
  return (
    capital !== undefined && game.terrain.topology.distance(capital, tile) <= capitalRadius(game)
  );
}

/**
 * R-CAP-05: the player whose attack on `id` has taken land within
 * B-CAPITAL-ALERT of `id`'s capital, the one with the most troops in such
 * attacks, the oldest attack first among equals; NEUTRAL when the capital
 * is safe or the game has no capitals. Interfaces warn the player with it,
 * and nations defend by it (R-BOT-17).
 */
export function capitalThreat(game: Game, id: number): number {
  const capital = capitalsStand(game) ? capitalOf(game, id) : undefined;
  if (capital === undefined) return NEUTRAL;
  const byPlayer = new Map<number, number>();
  for (const attack of game.attacks) {
    if (attack.target !== id || attack.troops <= 0) continue;
    byPlayer.set(attack.player, (byPlayer.get(attack.player) ?? 0) + attack.troops);
  }
  const { territory } = game;
  const topology = game.terrain.topology;
  const reach = capitalAlertDistance(game);
  // A player's tile closest to the capital is always one of their border tiles: one step nearer is someone else's.
  const near = (player: number): boolean => {
    const borders = territory.borderCount(player);
    for (let i = 0; i < borders; i++) {
      if (topology.distance(territory.borderTile(player, i), capital) <= reach) return true;
    }
    return false;
  };
  let threat = NEUTRAL;
  let most = 0;
  // Map iteration follows the attack list: the same on every client.
  for (const [player, troops] of byPlayer) {
    if (troops > most && near(player)) {
      threat = player;
      most = troops;
    }
  }
  return threat;
}

/**
 * The tile an attack on `tile`'s owner aims at when bots and nations play
 * capitals (R-BOT-17): that owner's capital when it has one, so the front
 * heads for it, or else the tile itself.
 */
export function capitalAim(game: Game, tile: number): number {
  if (!game.rules.capitals) return tile;
  const owner = game.territory.ownerOf(tile);
  const capital = owner === NEUTRAL ? undefined : capitalOf(game, owner);
  return capital !== undefined && game.territory.ownerOf(capital) === owner ? capital : tile;
}

/**
 * R-CAP-03: the player who took `player`'s capital takes all of their land,
 * in tile order, and B-CAPITAL-SPOILS of their troops; `player` keeps none.
 * The economy carries out the elimination in this tick's growth, the land
 * being gone, and hands the captor, who took the last tile, the gold
 * (R-ECO-05, R-ECO-08). The land and the two ledgers are shared state
 * (ADR 0010): this function is the one place capitals change them.
 */
export function handOverCapital(game: Game, player: Player, captor: Player): void {
  const { territory } = game;
  const owners = territory.owners;
  for (let t = 0; t < owners.length; t++) {
    if (owners[t] === player.id) territory.setOwner(t, captor.id);
  }
  captor.troops += percentOf(player.troops, game.balance.capitalSpoilsPercent);
  player.troops = 0;
}

/**
 * Capital mode (R-CAP-01 to R-CAP-04). When play starts, every player's
 * start tile becomes their capital. After the attacks, ships and missiles of
 * each tick, a capital whose tile another player now holds falls: that
 * player takes all of its owner's land, with what stands on it, and
 * B-CAPITAL-SPOILS of their troops and gold, and its owner is out of the
 * game. A capital whose tile went back to nobody is razed: its owner loses
 * B-CAPITAL-RAZE of their troops, and the capital moves to the land they
 * hold closest to it. Runs before structures change hands, so a conquered
 * player's structures go with their land in the same tick.
 */
export function installCapitals(game: Game): void {
  if (!game.rules.capitals) return;
  const { territory, balance } = game;
  const topology = game.terrain.topology;
  const capitals = game.addPart(CAPITALS, new PlayerValues(game, tileOrNone("capital"), -1));
  const falls = game.addPart(CAPITAL_FALLS, new RecordList(game, CAPITAL_FALL_RECORD)).entries;
  const setCapital = (player: Player, tile: number | undefined): void => {
    capitals.set(player.id, tile ?? -1);
  };

  game.onTick(() => {
    if (game.phase !== "play") return;
    // R-CAP-01: the start tile, placed or picked, once the spawn phase is over.
    if (game.tick === balance.spawnPhaseTicks) {
      for (const player of game.players()) {
        if (player.alive && player.start !== undefined) {
          setCapital(
            player,
            territory.ownerOf(player.start) === player.id
              ? player.start
              : closestOwned(player, player.start),
          );
        }
      }
    }
    // By player id: a conquest earlier in the tick can hand a capital back to its owner.
    for (const player of game.players()) {
      const capital = capitalOf(game, player.id);
      if (!player.alive || capital === undefined) continue;
      const holder = territory.ownerOf(capital);
      if (holder === player.id) continue;
      // R-CAP-06: during the grace, a capital taken moves to the land its owner has left.
      if (!capitalsStand(game)) setCapital(player, closestOwned(player, capital));
      // An ally's ship can land on a capital a missile razed: the capital still only moves.
      else if (holder === NEUTRAL || isAllied(game, holder, player.id)) raze(player, capital);
      else conquer(player, game.player(holder) as Player, capital);
    }
  });

  /** R-CAP-03: the holder of the capital's tile takes everything; its owner falls. */
  function conquer(player: Player, captor: Player, tile: number): void {
    handOverCapital(game, player, captor);
    setCapital(player, undefined);
    falls.push({ tick: game.tick, player: player.id, by: captor.id, tile });
    logEvent(game, { tick: game.tick, type: "capital", a: captor.id, b: player.id });
  }

  /** R-CAP-04: a capital on land gone back to nobody moves, at a price. */
  function raze(player: Player, tile: number): void {
    player.troops -= percentOf(player.troops, balance.capitalRazePercent);
    setCapital(player, closestOwned(player, tile));
    falls.push({ tick: game.tick, player: player.id, by: NEUTRAL, tile });
    logEvent(game, { tick: game.tick, type: "razed", a: player.id, b: player.id });
  }

  /**
   * The player's tile closest to `tile`, the lowest tile number among equals;
   * undefined without land. `tile` is never the player's, so the answer is
   * one of their border tiles: any other tile has all four neighbours in
   * their land, and the one a step towards `tile` is strictly closer.
   */
  function closestOwned(player: Player, tile: number): number | undefined {
    const borders = territory.borderList(player.id);
    let best: number | undefined;
    let closest = 0;
    for (let i = 0; i < borders.length; i++) {
      const t = borders[i] as number;
      const distance = topology.squaredDistance(t, tile);
      if (best === undefined || distance < closest || (distance === closest && t < best)) {
        best = t;
        closest = distance;
      }
    }
    return best;
  }
}
