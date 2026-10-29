import { isAllied, logEvent } from "./diplomacy.ts";
import type { Game, Player } from "./game.ts";
import { mulDiv, percentOf } from "./integer-math.ts";
import { spawnSettings } from "./spawn.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

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
  const capital = game.player(owner)?.capital;
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
  const capital = capitalsStand(game) ? game.player(id)?.capital : undefined;
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
  const capital = owner === NEUTRAL ? undefined : game.player(owner)?.capital;
  return capital !== undefined && game.territory.ownerOf(capital) === owner ? capital : tile;
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
  const falls = game.capitalFalls;

  game.persist("capitals", {
    save(out) {
      for (const player of game.players()) out.int(player.capital ?? -1);
      out.uint(falls.length);
      for (const f of falls) for (const value of [f.tick, f.player, f.by, f.tile]) out.uint(value);
    },
    load(from) {
      for (const player of game.players()) {
        const tile = from.int();
        player.capital = tile < 0 ? undefined : tile;
      }
      for (let n = from.count(); n > 0; n--) {
        falls.push({ tick: from.uint(), player: from.uint(), by: from.uint(), tile: from.uint() });
      }
    },
  });

  game.onTick(() => {
    if (game.phase !== "play") return;
    // R-CAP-01: the start tile, placed or picked, once the spawn phase is over.
    if (game.tick === balance.spawnPhaseTicks) {
      for (const player of game.players()) {
        if (player.alive && player.start !== undefined) {
          player.capital =
            territory.ownerOf(player.start) === player.id
              ? player.start
              : closestOwned(player, player.start);
        }
      }
    }
    // By player id: a conquest earlier in the tick can hand a capital back to its owner.
    for (const player of game.players()) {
      const capital = player.capital;
      if (!player.alive || capital === undefined) continue;
      const holder = territory.ownerOf(capital);
      if (holder === player.id) continue;
      // R-CAP-06: during the grace, a capital taken moves to the land its owner has left.
      if (!capitalsStand(game)) player.capital = closestOwned(player, capital);
      // An ally's ship can land on a capital a missile razed: the capital still only moves.
      else if (holder === NEUTRAL || isAllied(game, holder, player.id)) raze(player, capital);
      else conquer(player, game.player(holder) as Player, capital);
    }
  });

  /** R-CAP-03: the holder of the capital's tile takes everything; its owner falls. */
  function conquer(player: Player, captor: Player, tile: number): void {
    const owners = territory.owners;
    for (let t = 0; t < owners.length; t++) {
      if (owners[t] === player.id) territory.setOwner(t, captor.id);
    }
    captor.troops += percentOf(player.troops, balance.capitalSpoilsPercent);
    captor.gold += percentOf(player.gold, balance.capitalSpoilsPercent);
    // R-ECO-05 carries out the elimination in this tick's growth, the land being gone.
    player.troops = 0;
    player.gold = 0;
    player.goldRemainder = 0;
    player.capital = undefined;
    falls.push({ tick: game.tick, player: player.id, by: captor.id, tile });
    logEvent(game, { tick: game.tick, type: "capital", a: captor.id, b: player.id });
  }

  /** R-CAP-04: a capital on land gone back to nobody moves, at a price. */
  function raze(player: Player, tile: number): void {
    player.troops -= percentOf(player.troops, balance.capitalRazePercent);
    player.capital = closestOwned(player, tile);
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
