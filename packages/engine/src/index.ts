export {
  DIFFICULTIES,
  DISABLE_ALL,
  Disable,
  MAX_TEAMS,
  NO_RULES,
  OPERATOR_BONUS_ALL,
  ORDER_SPEC,
  ORDER_TYPES,
  OperatorBonus,
  RuleBit,
  TICK_RATE,
  type Difficulty,
  type GameRules,
  type Order,
  type OrderOf,
  type OrderType,
  type Turn,
} from "@frontfall/contracts";
export {
  AttackError,
  captureCost,
  cheapestTile,
  collapseDepth,
  defenderLoss,
  defensePerTile,
  installAttacks,
  pressureOf,
  troopsPerTile,
  type Attack,
} from "./attacks.ts";
export {
  BALANCE_SPEC,
  DEFAULT_BALANCE,
  checkBalance,
  digestBalance,
  type Balance,
  type BalanceKeySpec,
  type BalanceRange,
  type DigestGate,
} from "./balance.ts";
export {
  capitalAim,
  capitalAlertDistance,
  capitalFalls,
  capitalOf,
  capitalRadius,
  capitalThreat,
  capitalsStand,
  guardedByCapital,
  installCapitals,
  type CapitalFall,
} from "./capitals.ts";
export {
  BoatError,
  installBoats,
  reachableCoasts,
  seaRoute,
  type Boat,
  type SeaRoute,
} from "./boats.ts";
export { STANDARD_RULES, assertOrderRules, createGame, type Rule } from "./create-game.ts";
export {
  DiplomacyError,
  allianceOf,
  allianceState,
  alliesOf,
  truceMatesOf,
  tributeError,
  tributePrice,
  inTruce,
  allyError,
  betrayError,
  canRenew,
  embargoError,
  embargoUntil,
  embargoed,
  installDiplomacy,
  isAllied,
  isTruce,
  isTraitor,
  requestBetween,
  sameTeam,
  takeDiplomacyEvents,
  type Alliance,
  type AllianceRequest,
  type AllianceState,
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
export {
  goldIncome,
  installEconomy,
  playerGrowth,
  populationCap,
  soldiers,
  troopGrowth,
  workError,
  workShareOf,
  workers,
} from "./economy.ts";
export {
  DOCTRINE_COUNT,
  DOCTRINE_EFFECTS,
  Doctrine,
  doctrineError,
  doctrineOf,
  doctrinePercent,
  installDoctrines,
  isDoctrine,
  withDoctrine,
  type DoctrineCode,
  type DoctrineEffects,
} from "./doctrines.ts";
export { GiftError, giftError, giftedTroops, installGifts } from "./gifts.ts";
export {
  LANDMARK_EFFECTS,
  LandmarkEffect,
  guardedByLandmark,
  heldLandmarks,
  installLandmarks,
  landmarkFortressRadius,
  landmarkHolder,
  landmarkShieldRadius,
  type Landmark,
} from "./landmarks.ts";
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
  CITY_STATES_PER_NATION,
  installCityStates,
  installNations,
  NATION_WORK_PERCENT,
  NATION_THREAT_PERCENT,
  BOT_DIFFICULTIES,
  NATION_DIFFICULTIES,
  type BotDifficulty,
  type BotParameters,
  type BotShelter,
  type NationParameters,
  nationMood,
  type Mood,
} from "./bots/index.ts";
export {
  Game,
  type GameSetup,
  type OrderObserver,
  type PersistedPart,
  type Phase,
  type Player,
  type PlayerSetup,
  type TickSystem,
} from "./game.ts";
export { NO_OPERATOR, OPERATOR_FACTOR, leftOut, ruleBits, type OperatorBonuses } from "./modes.ts";
export { clamp, divFloor, isqrt, mulDiv, percentOf } from "./integer-math.ts";
export { ORDER_RULES, orderError } from "./orders.ts";
export {
  ANY_PHASE,
  PLAY_PHASE,
  defineOrder,
  planOrder,
  type OrderRule,
  type Refusal,
} from "./order-rules.ts";
export { DrawUsage, Random, derivedRandom, type RandomState } from "./random.ts";
export { SpawnError, installSpawn, spawnSettings } from "./spawn.ts";
export {
  BuildError,
  MOSQUE_TRIES,
  PALACE_CITIES,
  StructureKind,
  cityLimit,
  airDefenseShare,
  cityShare,
  disableBit,
  fortRadius,
  fortified,
  installStructures,
  isWonder,
  isReady,
  placementError,
  structureAt,
  buildTime,
  structureCost,
  structureCount,
  structureState,
  workingCities,
  type Structure,
  type StructureState,
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
  takeMissileEvents,
  type Fallout,
  type Missile,
  type MissileEvent,
} from "./missiles.ts";
export { Terrain, TileKind } from "./terrain.ts";
export { installTrade, tradeGold, type TradeShip } from "./trade.ts";
export {
  WarshipError,
  atWar,
  installWarships,
  patrolError,
  patrolRadius,
  warshipCost,
  warshipError,
  warshipState,
  type Fight,
  type Warship,
  type WarshipState,
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
