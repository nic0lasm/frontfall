import {
  BuildError,
  MissileError,
  MissileSize,
  StructureKind,
  TileKind,
  WarshipError,
  airDefenseRadius,
  fortRadius,
  isAllied,
  orderError,
  sameTeam,
  seaRoute,
  soldiers,
  type Game,
  type Order,
  type Structure,
} from "@frontfall/engine";
import type {
  ClickMode,
  ClickPreview,
  ClickRefusal,
  ClickResult,
  StructureType,
} from "./game-view.ts";

/** Tiles around a click within which a demolition finds the player's structure: one is a few pixels wide. */
const DEMOLISH_REACH = 3;
/**
 * Tiles around a click that still aim at the coast or the sea when the screen
 * gives no reach of its own (aimReach turns pixels into tiles at the zoom):
 * on a large map the coast is a line under a pixel wide, so a click by the
 * water, on the land or the sea, picks the closest coast tile that fits.
 */
const PORT_REACH = 8;
/** Coasts a sea attack near the click tries, closest first: each one is a route search. */
const LANDING_TRIES = 4;

/** Where an order lands: the tile it names, if it names one. */
function orderTile(order: Order): number | undefined {
  if (order.type === "build" || order.type === "demolish" || order.type === "patrol") {
    return order.tile;
  }
  if (order.type === "warship") return order.port;
  return order.type === "missile" ? order.target : undefined;
}

/**
 * What a build mode's click on `tile` would do, without doing it: where it
 * lands (a port snaps to the coast, a warship to its port), why it would be
 * refused, and the reach of a structure that guards its surroundings, in tiles.
 */
export function previewForClick(
  game: Game,
  you: number,
  tile: number,
  mode: ClickMode,
  reach = PORT_REACH,
): ClickPreview {
  const result = orderForClick(game, you, tile, 100, mode, reach);
  const radius =
    mode === "fort" ? fortRadius(game) : mode === "airDefense" ? airDefenseRadius(game) : undefined;
  const range = radius === undefined ? {} : { radius };
  if ("refused" in result) return { tile, refused: result.refused, ...range };
  return {
    tile: orderTile(result.order) ?? tile,
    ...(result.note ? { note: result.note } : {}),
    ...range,
  };
}

const STRUCTURE_KINDS: Readonly<Record<StructureType, StructureKind>> = {
  city: StructureKind.City,
  palace: StructureKind.Palace,
  fort: StructureKind.Fort,
  port: StructureKind.Port,
  silo: StructureKind.Silo,
  airDefense: StructureKind.AirDefense,
};

/** Engine refusals of a build order, as the interface explains them: one for each BuildError. */
const BUILD_REFUSALS: Readonly<Record<BuildError, ClickRefusal>> = {
  [BuildError.Early]: "early",
  [BuildError.Foreign]: "foreign",
  [BuildError.Crowded]: "crowded",
  [BuildError.Land]: "land",
  [BuildError.Coast]: "coast",
  [BuildError.Gold]: "gold",
  [BuildError.Disabled]: "disabled",
};

function isBuildError(error: string): error is BuildError {
  return Object.hasOwn(BUILD_REFUSALS, error);
}

/**
 * What a click on `tile` means for the human now: pick a start during the
 * spawn phase, then expand or attack with `ratio` percent of their troops,
 * by land when the target touches their land, by sea when it is a coast
 * on another land mass. Otherwise, why nothing happens. A click on the sea,
 * or inland where no attack goes, aims at the closest coast within `reach`
 * tiles; ports and warships look as far.
 */
export function orderForClick(
  game: Game,
  you: number,
  tile: number,
  ratio: number,
  mode: ClickMode = "attack",
  reach = PORT_REACH,
  seen?: number,
): ClickResult {
  const { terrain, territory } = game;
  const human = game.player(you);
  if (!human?.alive || game.winner !== undefined) return { refused: "over" };
  if (!Number.isInteger(tile) || tile < 0 || tile >= terrain.topology.size) {
    return { refused: "terrain" };
  }
  if (mode === "demolish") return demolishNear(game, you, tile);
  if (mode === "warship") return warshipFor(game, you, tile, reach);
  if (mode === "missile" || mode === "heavyMissile") {
    return missileAt(game, you, tile, mode === "heavyMissile");
  }
  if (mode === "port") return portNear(game, you, tile, reach);
  if (!terrain.isOwnable(tile)) {
    // On the sea: the coast closest to the click, someone else's, is the target.
    const coast =
      mode === "attack" ? landingsNear(game, you, tile, reach, () => true)[0] : undefined;
    return coast === undefined
      ? { refused: "terrain" }
      : orderForClick(game, you, coast, ratio, mode, 0);
  }
  if (game.phase === "play" && isAllied(game, you, territory.ownerOf(tile)) && mode === "attack") {
    return { refused: sameTeam(game, you, territory.ownerOf(tile)) ? "teammate" : "ally" };
  }
  if (
    mode === "city" ||
    mode === "palace" ||
    mode === "fort" ||
    mode === "silo" ||
    mode === "airDefense"
  ) {
    const order: Order = { type: "build", structure: STRUCTURE_KINDS[mode], tile };
    const error = orderError(game, human, order);
    if (error === undefined) return { order };
    // The tile was checked above: anything else is a placement rule.
    return { refused: isBuildError(error) ? BUILD_REFUSALS[error] : "terrain" };
  }
  if (game.phase === "spawn") return { order: { type: "spawn", tile } };
  if (territory.ownerOf(tile) === you) {
    // The screen runs a little behind the game: the tile shown as someone
    // else's may have just fallen to the player. The click was meant for that
    // holder, so it aims at the closest land still theirs.
    const stale = seen !== undefined && seen !== you ? staleTarget(game, tile, seen) : undefined;
    return stale === undefined
      ? { refused: "own" }
      : orderForClick(game, you, stale, ratio, mode, reach);
  }
  // R-ECO-07: the ratio is a share of the soldiers; workers stay at home.
  const troops = Math.floor((soldiers(human) * Math.min(100, Math.max(0, ratio))) / 100);
  if (troops < 1) return { refused: "troops" };

  // By land when the player borders the target's owner on the target's own
  // land mass: an attack starts from that border, so it must reach the click.
  const owner = territory.ownerOf(tile);
  const mass = terrain.landmassOf(tile);
  const around = new Int32Array(4);
  let touches = false;
  for (let i = 0; i < territory.borderCount(you) && !touches; i++) {
    const border = territory.borderTile(you, i);
    if (terrain.landmassOf(border) !== mass) continue;
    const count = terrain.topology.neighborsInto(border, around);
    for (let j = 0; j < count; j++) {
      const next = around[j] as number;
      if (territory.ownerOf(next) === owner && terrain.isOwnable(next)) touches = true;
    }
  }
  if (touches) {
    return { order: { type: "attack", target: tile, troops } };
  }
  // By sea: the click's own coast, or else the closest coast of the same
  // owner on the same land mass, for a click a little inland.
  const landing = [tile, ...landingsNear(game, you, tile, reach, (near) => near !== tile)]
    .filter((near) => terrain.isCoast(near) && territory.ownerOf(near) === owner)
    .filter((near) => terrain.landmassOf(near) === mass)
    .slice(0, LANDING_TRIES)
    .find((near) => seaRoute(game, you, near));
  if (landing !== undefined) {
    const atSea = game.boats.filter((boat) => boat.player === you).length;
    if (atSea >= game.balance.boatMax) return { refused: "ships" };
    return { order: { type: "embark", target: landing, troops } };
  }
  return { refused: "unreachable" };
}

/** How far from a click that fell to the player the land still held by the owner shown is looked for. */
const STALE_REACH = 3;

/** The land of `owner` closest to `tile`, within `STALE_REACH`. */
function staleTarget(game: Game, tile: number, owner: number): number | undefined {
  const { terrain, territory } = game;
  const topology = terrain.topology;
  let best: number | undefined;
  let distance = Infinity;
  for (const near of topology.tilesWithin(tile, STALE_REACH)) {
    if (!terrain.isOwnable(near) || territory.ownerOf(near) !== owner) continue;
    const d = topology.squaredDistance(near, tile);
    if (d < distance) {
      distance = d;
      best = near;
    }
  }
  return best;
}

/** Coast tiles not the player's within `reach` of the click and passing `accept`, closest first. */
function landingsNear(
  game: Game,
  you: number,
  tile: number,
  reach: number,
  accept: (near: number) => boolean,
): number[] {
  const { terrain, territory } = game;
  const topology = terrain.topology;
  if (reach <= 0) return [];
  return topology
    .tilesWithin(tile, reach)
    .filter(
      (near) =>
        terrain.isCoast(near) &&
        terrain.isOwnable(near) &&
        territory.ownerOf(near) !== you &&
        accept(near),
    )
    .map((near) => ({ near, distance: topology.squaredDistance(near, tile) }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ near }) => near);
}

/**
 * In port mode: a port on the player's coast tile closest to the click,
 * within `reach`, among those that take one. When none does, the refusal
 * is the one of the closest coast tile, or "coast" when the player holds
 * no coast there.
 */
function portNear(game: Game, you: number, tile: number, reach: number): ClickResult {
  const { terrain, territory } = game;
  const human = game.player(you);
  if (!human) return { refused: "over" };
  const topology = terrain.topology;
  let refusal: { error: string; distance: number } | undefined;
  let best: { tile: number; distance: number } | undefined;
  for (const near of topology.tilesWithin(tile, reach)) {
    if (territory.ownerOf(near) !== you || !terrain.isCoast(near)) continue;
    const distance = topology.squaredDistance(near, tile);
    const order: Order = { type: "build", structure: StructureKind.Port, tile: near };
    const error = orderError(game, human, order);
    if (error === undefined) {
      if (!best || distance < best.distance) best = { tile: near, distance };
    } else if (!refusal || distance < refusal.distance) {
      refusal = { error, distance };
    }
  }
  if (best) {
    const order: Order = { type: "build", structure: StructureKind.Port, tile: best.tile };
    return terrain.isOceanCoast(best.tile) ? { order } : { order, note: "lake" };
  }
  if (!refusal) {
    // No coast of the player's near: the click itself says why (the phase,
    // a left-out port, someone else's land), and on the sea, "coast".
    const error = orderError(game, human, {
      type: "build",
      structure: StructureKind.Port,
      tile,
    });
    return {
      refused: error !== undefined && isBuildError(error) ? BUILD_REFUSALS[error] : "coast",
    };
  }
  return { refused: isBuildError(refusal.error) ? BUILD_REFUSALS[refusal.error] : "terrain" };
}

/** In a missile mode: a launch at the tile clicked, land or not, from the closest loaded silo. */
function missileAt(game: Game, you: number, tile: number, heavy: boolean): ClickResult {
  const human = game.player(you);
  if (!human) return { refused: "over" };
  if (!game.terrain.isOwnable(tile)) return { refused: "terrain" };
  const order: Order = {
    type: "missile",
    target: tile,
    size: heavy ? MissileSize.Heavy : MissileSize.Light,
  };
  const error = orderError(game, human, order);
  if (error === undefined) return { order };
  if (error === MissileError.Early) return { refused: "early" };
  if (error === MissileError.Ally) {
    return {
      refused: sameTeam(game, you, game.territory.ownerOf(tile)) ? "teammate" : "ally",
    };
  }
  if (error === MissileError.Near) return { refused: "allyNear" };
  if (error === MissileError.Gold) return { refused: "gold" };
  return { refused: "silo" };
}

/**
 * In warship mode: a click near the player's port buys a warship there; a
 * click on water sends the player's closest warship that can reach it to
 * patrol around it. A click on the land away from the player's ports sends
 * one to the water closest to it, within `reach`; a click on the water with
 * no warship to send buys one at a port within `reach`.
 */
function warshipFor(game: Game, you: number, tile: number, reach: number): ClickResult {
  const human = game.player(you);
  if (!human) return { refused: "over" };
  if (game.phase !== "play") return { refused: "early" };
  const { terrain } = game;
  const topology = terrain.topology;
  // A click near the port finds it, as far as a click that built it reaches.
  const port = structureNear(game, you, tile, (s) => s.kind === StructureKind.Port, reach);
  let water: number | undefined = terrain.kind(tile) === TileKind.Water ? tile : undefined;
  if (water === undefined && !port) {
    let best = Infinity;
    for (const near of topology.tilesWithin(tile, reach)) {
      if (terrain.kind(near) !== TileKind.Water) continue;
      const distance = topology.squaredDistance(near, tile);
      if (distance < best) {
        best = distance;
        water = near;
      }
    }
  }
  if (water !== undefined) {
    const target = water;
    const ships = game.warships
      .filter((warship) => warship.player === you)
      .map((warship) => ({ id: warship.id, distance: topology.distance(warship.tile, target) }))
      .sort((a, b) => a.distance - b.distance);
    for (const { id } of ships) {
      const order: Order = { type: "patrol", ship: id, tile: target };
      if (orderError(game, human, order) === undefined) return { order };
    }
    // No warship and no port by a click on the land: buying one comes first.
    if (!port) {
      if (water !== tile) return { refused: ships.length > 0 ? "noWarship" : "port" };
      return { refused: ships.length > 0 ? "noWarship" : "noShip" };
    }
  }
  if (!port) return { refused: "port" };
  const order: Order = { type: "warship", port: port.tile };
  const error = orderError(game, human, order);
  if (error === undefined) return { order };
  if (error === WarshipError.Max) return { refused: "warships" };
  if (error === WarshipError.Gold) return { refused: "gold" };
  if (error === WarshipError.Shore) return { refused: "shore" };
  if (error === WarshipError.Disabled) return { refused: "disabled" };
  return { refused: "port" };
}

function demolishNear(game: Game, you: number, tile: number): ClickResult {
  const structure = structureNear(game, you, tile, () => true);
  return structure ? { order: { type: "demolish", tile: structure.tile } } : { refused: "nothing" };
}

/** The player's structure closest to the click and passing `accept`, within `reach` tiles. */
function structureNear(
  game: Game,
  you: number,
  tile: number,
  accept: (structure: Structure) => boolean,
  reach = DEMOLISH_REACH,
): Structure | undefined {
  const topology = game.terrain.topology;
  let best: Structure | undefined;
  let bestDistance = 0;
  for (const structure of game.structures) {
    if (structure.player !== you || !accept(structure)) continue;
    const distance = topology.distance(structure.tile, tile);
    if (distance <= reach && (!best || distance < bestDistance)) {
      best = structure;
      bestDistance = distance;
    }
  }
  return best;
}
