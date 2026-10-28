export {
  captureCost,
  defenderLoss,
  installAttacks,
  troopsPerTile,
  type Attack,
} from "./attacks.ts";
export { DEFAULT_BALANCE, type Balance } from "./balance.ts";
export { installBoats, reachableCoasts, seaRoute, type Boat, type SeaRoute } from "./boats.ts";
export { createGame } from "./create-game.ts";
export {
  DiplomacyError,
  allianceOf,
  alliesOf,
  allyError,
  betrayError,
  canRenew,
  embargoError,
  embargoed,
  installDiplomacy,
  isAllied,
  isTraitor,
  requestBetween,
  sameTeam,
  type Alliance,
  type AllianceRequest,
  type DiplomacyEvent,
  type Embargo,
  type RequestCooldown,
} from "./diplomacy.ts";
export {
  DESYNC_REPORT_VERSION,
  DesyncReportError,
  readDesyncReport,
  recreateGame,
  replayDesyncReport,
  type DesyncReport,
  type RecordedGame,
  type ReplayResult,
} from "./desync-report.ts";
export {
  GAME_RECORD_VERSION,
  readGameRecord,
  replayGameRecord,
  type GameRecord,
} from "./game-record.ts";
export { installEconomy, populationCap } from "./economy.ts";
export { GiftError, giftError, giftedTroops, installGifts } from "./gifts.ts";
export {
  QUICK_MESSAGES,
  QUICK_MESSAGE_TICKS,
  QuickError,
  installQuickMessages,
  quickAllowedAt,
  quickError,
} from "./quick-messages.ts";
export {
  installBots,
  installNations,
  NATION_FULL_PERCENT,
  NATION_PILE_MAX,
  NATION_PILE_SECONDS,
  NATION_THREAT_PERCENT,
  BOT_DIFFICULTIES,
  NATION_DIFFICULTIES,
  type BotDifficulty,
  type BotParameters,
  type NationParameters,
} from "./bots/index.ts";
export {
  DISABLE_ALL,
  leftOut,
  Disable,
  Game,
  MAX_TEAMS,
  type GameSetup,
  type Order,
  type OrderHandler,
  type PersistedPart,
  type Phase,
  type Player,
  type PlayerSetup,
  type TickSystem,
  type Turn,
} from "./game.ts";
export { clamp, divFloor, isqrt, mulDiv, percentOf } from "./integer-math.ts";
export { orderError } from "./orders.ts";
export { DrawUsage, Random, derivedRandom, type RandomState } from "./random.ts";
export { installSpawn, spawnSettings } from "./spawn.ts";
export {
  BuildError,
  StructureKind,
  cityLimit,
  cityShare,
  disableBit,
  fortRadius,
  fortified,
  installStructures,
  isReady,
  placementError,
  structureAt,
  buildTime,
  structureCost,
  structureCount,
  workingCities,
  type Structure,
} from "./structures.ts";
export {
  MissileError,
  MissileSize,
  airDefenseRadius,
  blastRadius,
  installMissiles,
  isMissileSize,
  launchSilo,
  missileCost,
  missileError,
  missileTile,
  type Fallout,
  type Missile,
} from "./missiles.ts";
export { Terrain, TileKind } from "./terrain.ts";
export { installTrade, type TradeShip } from "./trade.ts";
export {
  WarshipError,
  atWar,
  installWarships,
  patrolError,
  patrolRadius,
  warshipCost,
  warshipError,
  type Fight,
  type Warship,
} from "./warships.ts";
export { BoundedFloodFill } from "./territory/bounded-flood-fill.ts";
export { MAX_PLAYER_ID, NEUTRAL, TerritoryMap } from "./territory/territory-map.ts";
export type { Topology } from "./topology.ts";
export { TurnClock } from "./turn-clock.ts";
export { installVictory } from "./victory.ts";
export { WorldGrid, type WorldGridOptions } from "./world-grid.ts";
export {
  HILLS_FROM,
  MOUNTAINS_FROM,
  loadMap,
  type LoadedMap,
  type MapDescription,
} from "./map/load-map.ts";
export {
  MAGNITUDE_IMPASSABLE,
  MAP_FORMAT_VERSION,
  MAP_HEADER_BYTES,
  MapFileError,
  TILE_LAND,
  TILE_MAGNITUDE,
  TILE_SHORE,
  decodeMapFile,
  encodeMapFile,
  mapFileBytes,
  type MapFile,
} from "./map/map-file.ts";
export { sha256Hex } from "./map/sha256.ts";
export {
  SNAPSHOT_FORMAT,
  SNAPSHOT_MAX_BYTES,
  loadSnapshot,
  readSnapshotHeader,
  saveSnapshot,
  type LoadedSnapshot,
  type SnapshotHeader,
} from "./snapshot.ts";
