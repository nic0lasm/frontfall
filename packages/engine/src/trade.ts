import { withDoctrine } from "./doctrines.ts";
import { embargoed, isAllied, logEvent } from "./diplomacy.ts";
import type { Game, Player } from "./game.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { detExp, mulDiv } from "./integer-math.ts";
import { LandmarkEffect, withLandmarks } from "./landmarks.ts";
import { SeaRoutes } from "./sea-routes.ts";
import { spawnSettings } from "./spawn.ts";
import { writable } from "./state/lists.ts";
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
 * game with ports, and the golden replays with it (`bun run golden`).
 */
const SEARCH_TILES_PER_TICK = 25_000;

/**
 * B-TRADE-RANGE on this map, in water tiles. By default it reaches the whole
 * sea, so that every map trades alike. A shorter range, set for a map of 2^19
 * tiles, grows with the side of larger maps like the spawn radius, up to the
 * 65,535 tiles a route holds.
 */
export function tradeRange(game: Game): number {
  const { tradeRange: range, spawnRadius } = game.balance;
  return Math.min(0xffff, Math.max(range, mulDiv(range, spawnSettings(game).radius, spawnRadius)));
}

/** Water tiles from which a route counts as far when a port draws its partner (R-UNIT-03). */
const FAR_ROUTE = 300;

/** Logistic of `value` around `midpoint`, falling or rising by `rate` per unit: 0 to 1. */
function logistic(value: number, rate: number, midpoint: number): number {
  return 1 / (1 + detExp(-rate * (value - midpoint)));
}

/**
 * R-UNIT-03: gold each side earns from a ship that sailed `length` water tiles:
 * 50 a tile, plus a bonus that rises with the length around 300 tiles up to 75,000.
 */
export function tradeGold(length: number): number {
  return Math.floor(75_000 * logistic(length, 0.03, 300) + 50 * length);
}

/**
 * R-UNIT-03: the roll of a port succeeds one time in this many. B-TRADE-ODDS
 * for a player with six ports or more; a small economy gets going faster,
 * its rolls boosted by 1 + (6 − ports) / (10 × ports), squared: 2.25 times
 * the odds for one port, 1.44 for two, 1.21 for three, 1.1 for four, 1.04
 * for five. Then divided by the rolls the port has missed and by how
 * saturated the sea is with `ships` trade ships, down to a quarter of the
 * full pace.
 */
export function spawnRate(odds: number, ships: number, ports: number, missed: number): number {
  const few = Math.max(1, ports);
  // The boost is (9 × ports + 6) / (10 × ports) below six ports, 1 from six on.
  const over = few >= 6 ? 1 : 10 * few;
  const under = few >= 6 ? 1 : 9 * few + 6;
  const saturation = Math.max(
    1 - logistic(ships, Math.LN2 / 50, 330),
    0.25 * (1 - logistic(ships, Math.LN2 / 100, 800)),
  );
  const rate = (odds * over * over) / (under * under) / (missed + 1) / saturation;
  return Math.max(1, Math.floor(rate));
}

/**
 * R-UNIT-03: how many times each partner of a port goes into the draw. Every
 * partner once; drawn twice more often when it is far (B-TRADE-FAR water
 * tiles or more) and among the nearest third of the partners, at least the
 * nearest four; and once more when its owner is an ally and it is far.
 * `lengths` are the routes to the partners, in the same order.
 */
export function tradeWeights(lengths: readonly number[], allied: readonly boolean[]): number[] {
  const order = lengths
    .map((_, i) => i)
    .sort((a, b) => (lengths[a] as number) - (lengths[b] as number) || a - b);
  const near = Math.max(4, lengths.length / 3);
  const weights = lengths.map(() => 1);
  order.forEach((i, rank) => {
    const far = (lengths[i] as number) >= FAR_ROUTE;
    if (far && rank < near) weights[i] = (weights[i] as number) + 1;
    if (far && allied[i] === true) weights[i] = (weights[i] as number) + 1;
  });
  return weights;
}

/**
 * R-UNIT-04: the trade ship at `index` of `game.tradeShips` changes hands with
 * its cargo, taken by a warship, and leaves the sea; returns it. The warship
 * rules call it; the trade ships are this module's to change (ADR 0010).
 */
export function takeTradeShip(game: Game, index: number): Readonly<TradeShip> {
  const [taken] = writable(game, "tradeShips").splice(index, 1);
  if (!taken) throw new RangeError(`no trade ship at ${String(index)}`);
  return taken;
}

/**
 * Trade (R-BUILD-02, R-UNIT-03, R-DIPLO-05). A port opens once built and
 * finds its routes to every open port within B-TRADE-RANGE of sea. Every
 * B-TRADE-INTERVAL after it opened, a port with fewer than B-TRADE-MAX of its
 * ships at sea rolls for a ship (`spawnRate`) and, on a success, sends one to
 * a port of another player, drawn among those it has a route to and no
 * embargo cuts it off from. The ship sails at B-BOAT-SPEED; if a port of
 * another player still stands at the end and no embargo has come between the
 * two, both players earn `tradeGold` for the route. Otherwise it is lost.
 * A fallen player's trade ships sink. Runs after structures change hands.
 */
export function installTrade(game: Game): void {
  const { balance } = game;
  const routes = new SeaRoutes(game, tradeRange(game), SEARCH_TILES_PER_TICK);
  const ships = writable(game, "tradeShips");
  /** Rolls each port has missed since its last ship, by port id: every miss makes the next roll likelier (R-UNIT-03). */
  const rejections = new Map<number, number>();
  /** Ready ports by tile, rebuilt every tick. */
  const ports = new Map<number, Readonly<Structure>>();

  // Routes follow from the order ports got them in: searched again in that order, they are the same.
  game.persist("trade", {
    save(out) {
      const { ready, waiting, searched } = routes.state();
      for (const list of [ready, waiting]) {
        out.uint(list.length);
        for (const tile of list) out.uint(tile);
      }
      out.uint(searched + 1);
      out.uint(rejections.size);
      for (const [port, count] of rejections) {
        out.uint(port);
        out.uint(count);
      }
    },
    load(from) {
      const size = game.terrain.topology.size;
      const [ready, waiting] = [0, 1].map(() =>
        Array.from({ length: from.count() }, () => from.below(size, "port")),
      ) as [number[], number[]];
      routes.restore(ready, waiting, from.uint() - 1);
      rejections.clear();
      for (let i = from.count(); i > 0; i--) rejections.set(from.uint(), from.uint());
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

    const portsOf = new Map<number, number>();
    for (const port of ports.values())
      portsOf.set(port.player, (portsOf.get(port.player) ?? 0) + 1);
    for (const port of ports.values()) {
      const open = game.tick - port.readyAt;
      if (open === 0 || open % balance.tradeIntervalTicks !== 0) continue;
      let atSea = 0;
      for (const ship of ships) if (ship.port === port.id) atSea++;
      if (atSea >= balance.tradeMax) continue;
      const partners = routes.partnersOf(port.tile).filter((tile) => trades(port.player, tile));
      if (partners.length === 0) continue;
      // R-UNIT-03: a roll a second; the more ships sail, the fewer new ones, and a port that keeps missing gets likelier.
      const missed = rejections.get(port.id) ?? 0;
      const rate = spawnRate(
        balance.tradeOdds,
        ships.length,
        portsOf.get(port.player) ?? 1,
        missed,
      );
      const roll = derivedRandom(game.seed, game.tick, port.id, DrawUsage.TradeSpawn);
      if (roll % rate !== 0) {
        rejections.set(port.id, missed + 1);
        continue;
      }
      rejections.delete(port.id);
      // The nearest far ports, and allies' far ports, are drawn more often.
      const weights = tradeWeights(
        partners.map((tile) => routes.length(port.tile, tile) as number),
        partners.map((tile) => isAllied(game, port.player, ports.get(tile)?.player ?? 0)),
      );
      const weighted: number[] = [];
      partners.forEach((tile, i) => {
        for (let w = weights[i] as number; w > 0; w--) weighted.push(tile);
      });
      const draw = derivedRandom(game.seed, game.tick, port.id, DrawUsage.TradeDestination);
      const to = weighted[draw % weighted.length] as number;
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
    const gain = tradeGold(ship.path.length);
    const sender = game.player(ship.player);
    const receiver = game.player(ports.get(ship.to)?.player ?? 0);
    if (!sender || !receiver) return;
    const { landmarkTradePercent } = balance;
    // R-DOCTRINE: each side's doctrine changes what the ship brings it.
    const earned = (player: Player): number =>
      withLandmarks(
        game,
        player.id,
        LandmarkEffect.Trade,
        landmarkTradePercent,
        withDoctrine(game, player.id, "trade", gain),
      );
    const toSender = earned(sender);
    const toReceiver = earned(receiver);
    sender.gold += toSender;
    receiver.gold += toReceiver;
    // Told to the interface only, never read by the rules: each side sees its gain at the dock.
    logEvent(game, {
      tick: game.tick,
      type: "trade",
      a: sender.id,
      b: receiver.id,
      gold: toSender,
      tile: ship.to,
    });
    logEvent(game, {
      tick: game.tick,
      type: "trade",
      a: receiver.id,
      b: sender.id,
      gold: toReceiver,
      tile: ship.to,
    });
  }
}
