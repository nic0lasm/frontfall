import type { Game, Player } from "./game.ts";
import { isqrt, mulDiv } from "./integer-math.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** Side of the map the spawn values of balance.md are set for: about the square root of 2^19 tiles. */
const REFERENCE_SIDE = 724;

/**
 * Spawn radius, spacing and starting troops for this map (R-SPAWN-06).
 * The balance values hold on a map of 2^19 tiles; on larger maps the radius
 * and spacing grow with the square root of the area, never shrink, and the
 * starting troops grow with the start area.
 */
export function spawnSettings(game: Game): SpawnSettings {
  let settings = settingsByGame.get(game);
  if (!settings) {
    settings = scaledSettings(game);
    settingsByGame.set(game, settings);
  }
  return settings;
}

export interface SpawnSettings {
  readonly radius: number;
  readonly distance: number;
  readonly troops: number;
}

// The map and the balance of a game never change, nor do its settings: the population cap asks for them every tick.
const settingsByGame = new WeakMap<Game, SpawnSettings>();

function scaledSettings(game: Game): SpawnSettings {
  const { balance } = game;
  const side = isqrt(game.terrain.topology.size);
  const radius = Math.max(balance.spawnRadius, mulDiv(balance.spawnRadius, side, REFERENCE_SIDE));
  return {
    radius,
    distance: Math.max(balance.spawnDistance, mulDiv(balance.spawnDistance, side, REFERENCE_SIDE)),
    troops: mulDiv(balance.startTroops, radius * radius, balance.spawnRadius * balance.spawnRadius),
  };
}

/** Random draws allowed when placing a player who did not pick, before giving up on spacing. */
const PLACEMENT_ATTEMPTS = 1000;

/**
 * The spawn phase (R-SPAWN-01 to R-SPAWN-05). Players pick a start tile, and
 * may pick again until the phase ends; whoever has not picked by then is
 * placed at random. A nation starts on its map tile instead (R-BOT-07). Each
 * player's start is kept in `player.start`.
 */
export function installSpawn(game: Game): void {
  game.onOrder((_, player, order) => {
    if (order.type !== "spawn" || !isValidStart(game, player, order.tile)) return false;
    place(game, player, order.tile);
    return true;
  });

  game.onTick(() => {
    // The system runs before the tick counter moves: this is the last tick of the phase.
    if (game.tick !== game.balance.spawnPhaseTicks - 1) return;
    // Nations first, on the start their map gives them, so random places keep away from them.
    for (const player of game.players()) {
      if (player.alive && player.home !== undefined) placeAtHome(game, player, player.home);
    }
    for (const player of game.players()) {
      if (player.alive && player.start === undefined && player.home === undefined) {
        placeAtRandom(game, player);
      }
    }
  });
}

/** R-SPAWN-02: unowned ownable land, or the player's own, far enough from every other start. */
function isValidStart(
  game: Game,
  player: Player,
  tile: number,
  minDistance = spawnSettings(game).distance,
): boolean {
  if (!game.terrain.isOwnable(tile)) return false;
  const owner = game.territory.ownerOf(tile);
  if (owner !== NEUTRAL && owner !== player.id) return false;
  const topology = game.terrain.topology;
  for (const other of game.players()) {
    if (other === player || other.start === undefined) continue;
    if (topology.distance(other.start, tile) < minDistance) return false;
  }
  return true;
}

/** R-SPAWN-04: the tiles around the start, and the starting troops. Moving the start releases the old area. */
function place(game: Game, player: Player, tile: number): void {
  const { territory, terrain } = game;
  const { radius, troops } = spawnSettings(game);
  if (player.start !== undefined) {
    for (const old of terrain.topology.tilesWithin(player.start, radius)) {
      if (territory.ownerOf(old) === player.id) territory.setOwner(old, NEUTRAL);
    }
  }
  for (const claimed of terrain.topology.tilesWithin(tile, radius)) {
    if (terrain.isOwnable(claimed) && territory.ownerOf(claimed) === NEUTRAL) {
      territory.setOwner(claimed, player.id);
    }
  }
  player.start = tile;
  // R-BOT-04: a nation may start with a share of the troops.
  const start = game.popFactors.get(player.id)?.start;
  player.troops = start === undefined ? troops : mulDiv(troops, start, 100);
}

/**
 * R-BOT-07: a nation starts on its tile while that tile is free, without the
 * spacing of R-SPAWN-02: the map already keeps nations apart, and a player
 * who picked near one chose to. A player who took the tile took the nation's
 * place: it stays unplaced and is eliminated when play starts (R-ECO-05).
 */
function placeAtHome(game: Game, player: Player, home: number): void {
  if (player.start !== undefined) return;
  if (game.terrain.isOwnable(home) && game.territory.ownerOf(home) === NEUTRAL) {
    place(game, player, home);
  }
}

/**
 * R-SPAWN-03: a random valid tile drawn from the game's seed. On a crowded map
 * where no tile is far enough from the others, spacing is relaxed rather than
 * leaving the player out; on a map with no free land at all the player stays
 * unplaced, and is eliminated when play starts (R-ECO-05).
 */
function placeAtRandom(game: Game, player: Player): void {
  const size = game.terrain.topology.size;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const tile = game.random.nextInt(0, size);
    if (isValidStart(game, player, tile)) {
      place(game, player, tile);
      return;
    }
  }
  const offset = game.random.nextInt(0, size);
  for (let i = 0; i < size; i++) {
    const tile = (offset + i) % size;
    if (isValidStart(game, player, tile, 0)) {
      place(game, player, tile);
      return;
    }
  }
}
