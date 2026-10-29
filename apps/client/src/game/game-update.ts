import {
  MissileSize,
  StructureKind,
  allianceOf,
  alliesOf,
  atWar,
  canRenew,
  cityLimit,
  capitalThreat,
  cityShare,
  isReady,
  launchSilo,
  missileCost,
  missileTile,
  populationCap,
  quickAllowedAt,
  sameTeam,
  structureCost,
  troopGrowth,
  warshipCost,
  type Game,
} from "@frontfall/engine";
import type {
  DiplomacyEvent,
  DiplomacyView,
  EconomyView,
  GameUpdate,
  StructureType,
} from "./game-view.ts";
import { labelAnchors, type LabelSpace } from "./label-anchors.ts";

const STRUCTURE_TYPES: Readonly<Record<StructureKind, StructureType>> = {
  [StructureKind.City]: "city",
  [StructureKind.Fort]: "fort",
  [StructureKind.Port]: "port",
  [StructureKind.Silo]: "silo",
  [StructureKind.AirDefense]: "airDefense",
  [StructureKind.Palace]: "palace",
};

/** Names follow the land twice a second at the default tick rate: a scan of the map each time. */
const LABEL_TICKS = 5;

function diplomacy(game: Game, you: number): DiplomacyView {
  const tick = game.tick;
  return {
    allies: alliesOf(game, you).map((id) => {
      const alliance = allianceOf(game, you, id);
      const until = alliance?.until ?? tick;
      return {
        id,
        ticksLeft: until - tick,
        renewable: alliance !== undefined && canRenew(game, alliance),
        renewing:
          alliance !== undefined && (you === alliance.a ? alliance.renewA : alliance.renewB),
      };
    }),
    teammates: game
      .players()
      .filter((player) => sameTeam(game, you, player.id))
      .map((player) => player.id),
    incoming: game.allianceRequests
      .filter((request) => request.to === you && tick < request.expiresAt)
      .map((request) => ({ from: request.from, ticksLeft: request.expiresAt - tick })),
    outgoing: game.allianceRequests
      .filter((request) => request.from === you && tick < request.expiresAt)
      .map((request) => request.to),
    waiting: game.requestCooldowns
      .filter((cooldown) => cooldown.from === you && tick < cooldown.until)
      .map((cooldown) => cooldown.to),
    traitors: game
      .players()
      .filter((player) => player.alive && tick < player.traitorUntil)
      .map((player) => ({ id: player.id, ticksLeft: player.traitorUntil - tick })),
    embargoes: game.embargoes.filter((e) => e.from === you).map((e) => e.to),
    embargoedBy: game.embargoes.filter((e) => e.to === you).map((e) => e.from),
    atWar: game
      .players()
      .filter((player) => player.alive && atWar(game, you, player.id))
      .map((player) => player.id),
    quickIn: Math.max(0, quickAllowedAt(game, you) - tick),
  };
}

/** What the engine logged between players since the last update, in order (R-DIPLO-04). */
function diplomacyEvents(game: Game): DiplomacyEvent[] {
  return game.diplomacyEvents.splice(0).map(({ type, a, b, phrase, tile, gold }) => {
    const event: DiplomacyEvent = { type, a, b };
    if (phrase !== undefined) event.phrase = phrase;
    if (tile !== undefined) event.tile = tile;
    if (gold !== undefined) event.gold = gold;
    return event;
  });
}

/**
 * What the interface needs after the ticks just played, as `you` sees it. It
 * takes the territory changes and the diplomacy events the engine logged, so
 * each tick's are sent once: call it once per update.
 */
export function gameUpdate(game: Game, you: number, labelSpace: LabelSpace): GameUpdate {
  const territory = game.territory;
  const players = game.players().map((player) => ({
    id: player.id,
    name: player.name,
    troops: player.troops,
    cap: populationCap(game, player),
    gold: player.gold,
    workShare: player.workShare,
    tiles: territory.tileCount(player.id),
    alive: player.alive,
    ...(player.capital === undefined ? {} : { capital: player.capital }),
  }));
  const update: GameUpdate = {
    you: you,
    tick: game.tick,
    phase: game.phase,
    spawnTicksLeft: Math.max(0, game.balance.spawnPhaseTicks - game.tick),
    players,
    attacks: game.attacks
      .filter((attack) => attack.player === you)
      .map((attack) => ({ id: attack.id, target: attack.target, troops: attack.troops })),
    changedTiles: new Int32Array(0),
    changedOwners: new Uint16Array(0),
    boats: game.boats.map((boat) => ({
      id: boat.id,
      player: boat.player,
      // The water tile the ship has reached, its first one before it sails.
      tile: boat.path[Math.max(0, Math.min(boat.step, boat.path.length) - 1)] ?? boat.target,
      troops: boat.troops,
    })),
    tradeShips: game.tradeShips.map((ship) => ({
      id: ship.id,
      player: ship.player,
      tile: ship.path[Math.max(0, Math.min(ship.step, ship.path.length) - 1)] ?? ship.from,
    })),
    warships: game.warships.map((ship) => ({
      id: ship.id,
      player: ship.player,
      tile: ship.tile,
      health: ship.health,
    })),
    missiles: game.missiles.map((missile) => ({
      id: missile.id,
      player: missile.player,
      heavy: missile.size === MissileSize.Heavy,
      tile: missileTile(game, missile, game.tick),
      to: missile.to,
      target: territory.ownerOf(missile.to),
    })),
    fallout: game.fallout.map(({ tile, radius }) => ({ tile, radius })),
    structures: game.structures.map((structure) => ({
      id: structure.id,
      player: structure.player,
      type: STRUCTURE_TYPES[structure.kind],
      tile: structure.tile,
      ready: isReady(game, structure),
    })),
    build: {
      cityCost: structureCost(game, you, StructureKind.City),
      palaceCost: structureCost(game, you, StructureKind.Palace),
      fortCost: structureCost(game, you, StructureKind.Fort),
      portCost: structureCost(game, you, StructureKind.Port),
      warshipCost: warshipCost(game, you),
      siloCost: structureCost(game, you, StructureKind.Silo),
      airDefenseCost: structureCost(game, you, StructureKind.AirDefense),
      missileCost: missileCost(game, MissileSize.Light),
      heavyMissileCost: missileCost(game, MissileSize.Heavy),
      // Any tile will do: whether one is loaded does not depend on the target.
      loaded: launchSilo(game, you, 0) !== undefined,
      cities: cityShare(game, you),
      cityLimit: cityLimit(game, you),
    },
    economy: economy(game, you),
    diplomacy: diplomacy(game, you),
    events: diplomacyEvents(game),
  };
  if (territory.changesOverflowed) {
    update.owners = territory.owners.slice();
  } else {
    const changes = territory.changes();
    update.changedTiles = changes.slice();
    update.changedOwners = new Uint16Array(changes.length);
    for (let i = 0; i < changes.length; i++) {
      update.changedOwners[i] = territory.owners[changes[i] as number] as number;
    }
  }
  territory.clearChanges();
  if (game.tick % LABEL_TICKS === 0) {
    const width = game.terrain.topology.width;
    update.labels = labelAnchors(territory.owners, width, players.length, labelSpace);
  }
  if (game.rules.capitals) {
    update.capitals = {
      falls: game.capitalFalls.map(({ tick, player, by }) => ({ tick, player, by })),
      threat: capitalThreat(game, you),
      standsIn: Math.max(
        0,
        game.balance.spawnPhaseTicks + game.balance.capitalGraceTicks - game.tick,
      ),
    };
  }
  if (game.winner !== undefined) update.winner = game.winner;
  if (game.winningTeam !== undefined) update.winningTeam = game.winningTeam;
  return update;
}

/** R-ECO-02: troops the player at this screen gains each second, as of now. */
function economy(game: Game, you: number): EconomyView {
  const player = game.player(you);
  if (!player?.alive || game.phase !== "play") return { growth: 0 };
  return {
    growth:
      troopGrowth(game.balance, populationCap(game, player), player.troops) *
      game.balance.ticksPerSecond,
  };
}
