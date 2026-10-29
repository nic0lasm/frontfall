import { embargoed } from "./diplomacy.ts";
import type { Game } from "./game.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { mulDiv } from "./integer-math.ts";
import { LandmarkEffect, withLandmarks } from "./landmarks.ts";
import { SeaRoutes } from "./sea-routes.ts";
import { spawnSettings } from "./spawn.ts";
import { StructureKind, isReady, type Structure } from "./structures.ts";

/** A trade ship sailing from one port to another (R-UNIT-03). */
export interface TradeShip {
  readonly id: number;
  /** Owner of the port it left, when it left; paid on arrival. */
  readonly player: number;
  /** Id of the port structure it left, which counts its ships at sea. */
  readonly port: number;
  /** Port tiles it sails from and to. */
  readonly from: number;
  readonly to: number;
  /** Water tiles from the port it left to the one it sails for; shared with the route, never written. */
  readonly path: Int32Array;
  /** How far along `path` the ship is; it arrives once this reaches `path.length`. */
  step: number;
}

/**
 * Water tiles the search for a new port's routes walks per tick, a few
 * milliseconds' worth: on World, one search reaches most of the sea and
 * would stall a tick for some 50 ms at once. It decides on which tick a
 * route opens, so it is part of the simulation: changing it changes every
 * game with ports, and the golden replays with it (`pnpm golden`).
 */
const SEARCH_TILES_PER_TICK = 25_000;

/**
 * B-TRADE-RANGE on this map, in water tiles: set for a map of 2^19 tiles,
 * it grows with the side of larger maps like the spawn radius, so ports as
 * far apart as players start still trade.
 */
export function tradeRange(game: Game): number {
  const { tradeRange: range, spawnRadius } = game.balance;
  return Math.max(range, mulDiv(range, spawnSettings(game).radius, spawnRadius));
}

/**
 * Trade (R-BUILD-02, R-UNIT-03, R-DIPLO-05). A port opens once built and
 * finds its routes to every open port within B-TRADE-RANGE of sea. Every
 * B-TRADE-INTERVAL after it opened, a port with fewer than B-TRADE-MAX of its
 * ships at sea sends one to a port of another player, drawn among those it
 * has a route to and no embargo cuts it off from. The ship sails at
 * B-BOAT-SPEED; if a port of another player still stands at the end and no
 * embargo has come between the two, both players earn B-TRADE-BASE plus
 * B-TRADE-PER-TILE for each water tile of the route. Otherwise it is lost.
 * A fallen player's trade ships sink. Runs after structures change hands.
 */
export function installTrade(game: Game): void {
  const { balance } = game;
  const routes = new SeaRoutes(game, tradeRange(game), SEARCH_TILES_PER_TICK);
  const ships = game.tradeShips;
  /** Ready ports by tile, rebuilt every tick. */
  const ports = new Map<number, Structure>();

  // Routes follow from the order ports got them in: searched again in that order, they are the same.
  game.persist("trade", {
    save(out) {
      const { ready, waiting, searched } = routes.state();
      for (const list of [ready, waiting]) {
        out.uint(list.length);
        for (const tile of list) out.uint(tile);
      }
      out.uint(searched + 1);
    },
    load(from) {
      const size = game.terrain.topology.size;
      const [ready, waiting] = [0, 1].map(() =>
        Array.from({ length: from.count() }, () => from.below(size, "port")),
      ) as [number[], number[]];
      routes.restore(ready, waiting, from.uint() - 1);
    },
  });

  game.onTick(() => {
    ports.clear();
    for (const structure of game.structures) {
      if (structure.kind === StructureKind.Port && isReady(game, structure)) {
        ports.set(structure.tile, structure);
      }
    }
    for (const tile of routes.openPorts()) if (!ports.has(tile)) routes.close(tile);
    // Oldest first, so every client opens them in the same order and finds the same routes.
    for (const tile of ports.keys()) routes.open(tile);
    routes.work();

    let kept = 0;
    for (const ship of ships) {
      if (!game.player(ship.player)?.alive) continue;
      ship.step = Math.min(ship.step + balance.boatSpeed, ship.path.length);
      if (ship.step === ship.path.length) arrive(ship);
      else ships[kept++] = ship;
    }
    ships.length = kept;

    for (const port of ports.values()) {
      const open = game.tick - port.readyAt;
      if (open === 0 || open % balance.tradeIntervalTicks !== 0) continue;
      let atSea = 0;
      for (const ship of ships) if (ship.port === port.id) atSea++;
      if (atSea >= balance.tradeMax) continue;
      const partners = routes.partnersOf(port.tile).filter((tile) => trades(port.player, tile));
      if (partners.length === 0) continue;
      const draw = derivedRandom(game.seed, game.tick, port.id, DrawUsage.TradeDestination);
      const to = partners[draw % partners.length] as number;
      ships.push({
        id: game.nextTradeShipId++,
        player: port.player,
        port: port.id,
        from: port.tile,
        to,
        path: routes.route(port.tile, to) as Int32Array,
        step: 0,
      });
    }
  });

  /** Whether `player` trades with the port on `tile`: another player's, alive, and no embargo between them. */
  function trades(player: number, tile: number): boolean {
    const owner = ports.get(tile)?.player;
    if (owner === undefined || owner === player) return false;
    return game.player(owner)?.alive === true && !embargoed(game, player, owner);
  }

  function arrive(ship: TradeShip): void {
    if (!trades(ship.player, ship.to)) return;
    const gain = balance.tradeBase + balance.tradePerTile * ship.path.length;
    const sender = game.player(ship.player);
    const receiver = game.player(ports.get(ship.to)?.player ?? 0);
    if (!sender || !receiver) return;
    const { landmarkTradePercent } = balance;
    sender.gold += withLandmarks(game, sender.id, LandmarkEffect.Trade, landmarkTradePercent, gain);
    receiver.gold += withLandmarks(
      game,
      receiver.id,
      LandmarkEffect.Trade,
      landmarkTradePercent,
      gain,
    );
  }
}
