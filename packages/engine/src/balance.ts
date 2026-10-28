/**
 * Balance values from docs/balance.md, converted to the units the engine uses.
 * Each field names its key in that document; change both together.
 */
export interface Balance {
  /** B-TICK-RATE */
  ticksPerSecond: number;
  /** B-SPAWN-PHASE, in ticks */
  spawnPhaseTicks: number;
  /** B-SPAWN-DISTANCE, in tiles */
  spawnDistance: number;
  /** B-SPAWN-RADIUS, in tiles */
  spawnRadius: number;
  /** B-START-TROOPS */
  startTroops: number;
  /** B-POP-PER-TILE, troops of population cap per owned tile */
  popPerTile: number;
  /** B-POP-FALLOFF-SHARE, percent of all ownable land beyond which tiles add less to the cap */
  popFalloffSharePercent: number;
  /** B-POP-FALLOFF, percent of B-POP-PER-TILE that each tile beyond that share adds */
  popFalloffPercent: number;
  /** B-POP-PER-CITY, percent of the cap the player's land gives that each working city adds */
  popPerCityPercent: number;
  /** B-GROWTH-RATE, in basis points of the gap to the cap per second (320 = 3.2 %) */
  growthBasisPoints: number;
  /** B-GROWTH-FLOOR, percent of B-GROWTH-RATE that an empty army grows at; a full rate at any size is 100 */
  growthFloorPercent: number;
  /** B-GOLD-RATE, in thousandths of gold per idle troop per second (5 = 0.5 per 100) */
  goldPerThousandTroops: number;
  /** B-WORK-MAX, the largest share of troops at home, in %, a player may put to work */
  workMaxPercent: number;
  /** B-WORK-GOLD, how many times a soldier's gold a worker earns */
  workGoldFactor: number;
  /** B-NEUTRAL-COST, troops per plains tile of unowned land */
  neutralCost: number;
  /** B-RELIEF-COST, in tenths, for plains, hills and mountains */
  reliefCostTenths: readonly [number, number, number];
  /** B-ATTACK-SPEED: an attack takes 1 + isqrt(troops) / attackSpeedDivisor tiles per tick */
  attackSpeedDivisor: number;
  /** B-ATTACK-SPREAD, tiles of distance to the aim that each side shared with the attacker's land is worth */
  attackSpread: number;
  /** B-DEFENSE-DENSITY, in tenths: share of the defender's troops per tile added to the cost of a tile */
  defenseDensityTenths: number;
  /** B-RETREAT-PENALTY, percent of the returning troops lost */
  retreatPenaltyPercent: number;
  /** B-ENCIRCLE-MAX, largest pocket in tiles captured at once by encirclement */
  encircleMaxTiles: number;
  /** B-COLLAPSE-ODDS, in tenths: an attack overwhelms a front when its troops are this many times the garrison facing it */
  collapseOddsTenths: number;
  /** B-COLLAPSE-BUILDUP, in ticks of overwhelming advance before a front gives way */
  collapseBuildupTicks: number;
  /** B-COLLAPSE-DEPTH, in tiles on a map of 2^19 tiles: how far behind its tip a front gives way */
  collapseDepth: number;
  /** B-COLLAPSE-COST, percent of the usual price the attacker pays for land that gives way */
  collapseCostPercent: number;
  /** B-BOAT-SPEED, water tiles a transport ship moves per tick */
  boatSpeed: number;
  /** B-BOAT-MAX, transport ships a player may have at sea at once */
  boatMax: number;
  /** B-BOAT-RANGE, longest sea route in water tiles */
  boatRange: number;
  /** B-BUILD-TIME, in ticks from the order to the first tick a structure works */
  buildTicks: number;
  /** B-COST-CITY, gold for a player's first city */
  cityCost: number;
  /** B-COST-FORT, gold for a player's first fort */
  fortCost: number;
  /** B-COST-PORT, gold for a player's first port */
  portCost: number;
  /** B-COST-GROWTH, percent: each structure of a kind already owned multiplies the cost of the next by this */
  costGrowthPercent: number;
  /** B-BUILD-SPACING, smallest distance in tiles between two structures */
  buildSpacing: number;
  /** B-CITY-LAND, tiles of land each city beyond the first needs, on a map of 2^19 tiles */
  cityLand: number;
  /** B-FORT-RADIUS, in tiles on a map of 2^19 tiles */
  fortRadius: number;
  /** B-FORT-STRENGTH, percent of the usual price an attacker pays for a tile a fort covers */
  fortStrengthPercent: number;
  /** B-FORT-LOSSES, percent of the usual troops a defender loses with a tile a fort covers */
  fortLossPercent: number;
  /** B-TRADE-RANGE, longest trade route between two ports, in water tiles */
  tradeRange: number;
  /** B-TRADE-INTERVAL, ticks between two departures from one port */
  tradeIntervalTicks: number;
  /** B-TRADE-MAX, trade ships from one port at sea at once */
  tradeMax: number;
  /** B-TRADE-BASE, gold each side earns from a trade ship that arrives */
  tradeBase: number;
  /** B-TRADE-PER-TILE, gold each side earns on top for each water tile of the route */
  tradePerTile: number;
  /** B-COST-WARSHIP, gold for a player's first warship */
  warshipCost: number;
  /** B-WARSHIP-MAX, warships a player may own at once */
  warshipMax: number;
  /** B-WARSHIP-PATROL, in water tiles around the patrol tile, on a map of 2^19 tiles */
  warshipPatrol: number;
  /** B-WARSHIP-RANGE, in tiles */
  warshipRange: number;
  /** B-WARSHIP-RELOAD, in ticks between two shots */
  warshipReloadTicks: number;
  /** B-WARSHIP-DAMAGE, health a hit takes from a warship */
  warshipDamage: number;
  /** B-WARSHIP-HEALTH */
  warshipHealth: number;
  /** B-WAR-MEMORY, in ticks a fight is remembered after it ends */
  warMemoryTicks: number;
  /** B-EMBARGO-NOTICE, in ticks an embargo must hold before trade ships can be taken */
  embargoNoticeTicks: number;
  /** B-COST-SILO, gold for a player's first missile silo */
  siloCost: number;
  /** B-COST-AIR-DEFENSE, gold for a player's first air defense */
  airDefenseCost: number;
  /** B-BUILD-TIME-LONG, in ticks from the order to the first tick a silo or an air defense works */
  longBuildTicks: number;
  /** B-SILO-RELOAD, in ticks from a launch to the next one from the same silo */
  siloReloadTicks: number;
  /** B-COST-MISSILE, gold for a missile */
  missileCost: number;
  /** B-COST-HEAVY-MISSILE, gold for a heavy missile */
  heavyMissileCost: number;
  /** B-MISSILE-RADIUS, blast radius of a missile, in tiles on a map of 2^19 tiles */
  missileRadius: number;
  /** B-HEAVY-MISSILE-RADIUS, blast radius of a heavy missile, in tiles on a map of 2^19 tiles */
  heavyMissileRadius: number;
  /** B-MISSILE-SPEED, tiles a missile flies per tick */
  missileSpeed: number;
  /** B-FALLOUT-TIME, in ticks the land under a heavy missile stays unusable */
  falloutTicks: number;
  /** B-AIR-DEFENSE-RADIUS, in tiles on a map of 2^19 tiles */
  airDefenseRadius: number;
  /** B-AIR-DEFENSE-CHANCE, percent chance to stop a missile */
  airDefenseChancePercent: number;
  /** B-AIR-DEFENSE-RELOAD, in ticks from one missile stopped to the next one tried */
  airDefenseReloadTicks: number;
  /** B-ALLIANCE-REQUEST-TIMEOUT, in ticks */
  allianceRequestTicks: number;
  /** B-ALLIANCE-DURATION, in ticks */
  allianceTicks: number;
  /** B-ALLIANCE-RENEWAL, in ticks before the end of an alliance from which it can be renewed */
  allianceRenewTicks: number;
  /** B-ALLIANCE-REQUEST-COOLDOWN, in ticks from a request running out to the next one to the same player */
  allianceCooldownTicks: number;
  /** B-TRAITOR-DURATION, in ticks */
  traitorTicks: number;
  /** B-TRAITOR-DEFENSE, percent of the usual price an attacker pays for a traitor's tile */
  traitorDefensePercent: number;
  /** B-WIN-SHARE, percent of all ownable land */
  winSharePercent: number;
  /** B-MAX-DURATION, in ticks */
  maxDurationTicks: number;
}

export const DEFAULT_BALANCE: Balance = {
  ticksPerSecond: 10,
  spawnPhaseTicks: 20 * 10,
  spawnDistance: 30,
  spawnRadius: 3,
  startTroops: 2500,
  popPerTile: 40,
  popFalloffSharePercent: 20,
  popFalloffPercent: 100,
  popPerCityPercent: 5,
  growthBasisPoints: 800,
  growthFloorPercent: 20,
  goldPerThousandTroops: 5,
  workMaxPercent: 80,
  workGoldFactor: 4,
  neutralCost: 8,
  reliefCostTenths: [10, 15, 25],
  attackSpeedDivisor: 4,
  attackSpread: 4,
  defenseDensityTenths: 10,
  retreatPenaltyPercent: 25,
  encircleMaxTiles: 4000,
  collapseOddsTenths: 30,
  collapseBuildupTicks: 3 * 10,
  collapseDepth: 5,
  collapseCostPercent: 50,
  boatSpeed: 2,
  boatMax: 3,
  boatRange: 1000,
  buildTicks: 5 * 10,
  cityCost: 60_000,
  fortCost: 30_000,
  portCost: 100_000,
  costGrowthPercent: 150,
  buildSpacing: 10,
  cityLand: 10_000,
  fortRadius: 25,
  fortStrengthPercent: 200,
  fortLossPercent: 50,
  tradeRange: 500,
  tradeIntervalTicks: 10 * 10,
  tradeMax: 3,
  tradeBase: 2000,
  tradePerTile: 20,
  warshipCost: 250_000,
  warshipMax: 4,
  warshipPatrol: 30,
  warshipRange: 12,
  warshipReloadTicks: 10,
  warshipDamage: 250,
  warshipHealth: 1000,
  warMemoryTicks: 30 * 10,
  embargoNoticeTicks: 30 * 10,
  siloCost: 800_000,
  airDefenseCost: 1_000_000,
  longBuildTicks: 10 * 10,
  siloReloadTicks: 30 * 10,
  missileCost: 300_000,
  heavyMissileCost: 1_500_000,
  missileRadius: 12,
  heavyMissileRadius: 30,
  missileSpeed: 8,
  falloutTicks: 60 * 10,
  airDefenseRadius: 60,
  airDefenseChancePercent: 75,
  airDefenseReloadTicks: 10 * 10,
  allianceRequestTicks: 20 * 10,
  allianceTicks: 300 * 10,
  allianceRenewTicks: 60 * 10,
  allianceCooldownTicks: 30 * 10,
  traitorTicks: 30 * 10,
  traitorDefensePercent: 50,
  winSharePercent: 75,
  maxDurationTicks: 3600 * 10,
};
