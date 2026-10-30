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
  /** B-POP-BASE, troops every player's cap holds whatever their land */
  popBase: number;
  /** B-POP-LAND, troops of cap for the land's 0.6 power: a player with n tiles holds n^0.6 times this */
  popLand: number;
  /** B-POP-PER-CITY, troops of cap each working city adds */
  popPerCity: number;
  /** B-GROWTH-BASE, troops a player gains each tick whatever their army */
  growthBase: number;
  /** B-GROWTH-DIVISOR, the army's 0.73 power divided by this is added to the growth of a tick */
  growthDivisor: number;
  /** B-DESERTION, in basis points of the troops above the cap who leave each second (500 = 5 %) */
  desertionBasisPoints: number;
  /** B-GOLD-RATE, in thousandths of gold per idle troop per second (5 = 0.5 per 100) */
  goldPerThousandTroops: number;
  /** B-GOLD-BASE, gold per second every living player earns whatever their size */
  goldBase: number;
  /** B-WORK-MAX, the largest share of troops at home, in %, a player may put to work */
  workMaxPercent: number;
  /** B-WORK-GOLD, percent more gold of the base income when the whole cap works */
  workGoldPercent: number;
  /** B-TILE-WEIGHT, in tenths of a troop, for plains, hills and mountains: what a tile's price is measured in */
  tileWeightTenths: readonly [number, number, number];
  /** B-NEUTRAL-SHARE, percent of a tile's weight that unowned land costs a player or a nation */
  neutralSharePercent: number;
  /** B-BOT-NEUTRAL-SHARE, percent of a tile's weight that unowned land costs a bot */
  botNeutralSharePercent: number;
  /** B-ATTACK-SPEED: an attack takes 1 + isqrt(troops) / attackSpeedDivisor tiles per tick */
  attackSpeedDivisor: number;
  /** B-ATTACK-PACE, percent of its front's length an attack on a player at full strength takes per tick; 0 leaves only B-ATTACK-SPEED */
  attackPacePercent: number;
  /** B-ATTACK-PACE-ODDS, in tenths: troops, as a multiple of the garrison facing them, an attack needs for full pace */
  attackPaceOddsTenths: number;
  /** B-ATTACK-SPREAD, tiles of distance to the aim that each side shared with the attacker's land is worth */
  attackSpread: number;
  /** B-LOSS-BASE, in thousandths: the part of a player's tile price that every tile costs, times its weight */
  lossBaseThousandths: number;
  /** B-LOSS-DENSITY, in thousandths: the part of a player's tile price per soldier of theirs on each tile, times its weight */
  lossDensityThousandths: number;
  /** B-ODDS-MIN and B-ODDS-MAX, percent: the defender's soldiers per attacking troop, held between these, scale a player's tile price */
  oddsMinPercent: number;
  oddsMaxPercent: number;
  /** B-LARGE-MID, tiles: the size at which a large territory gets half its price bonus */
  largeMidTiles: number;
  /** B-LARGE-ATTACKER and B-LARGE-DEFENDER, percent: how far a huge attacker's, then a huge defender's, size lowers a tile's price */
  largeAttackerPercent: number;
  largeDefenderPercent: number;
  /** B-BOT-DEFENSE, percent of the price a player or a nation pays for a bot's tile */
  botDefensePercent: number;
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
  /** B-COST-MAX, gold no city, port or warship costs more than */
  costMax: number;
  /** B-COST-FORT-MAX, gold no fort costs more than */
  fortCostMax: number;
  /** B-COST-AIR-DEFENSE-MAX, gold no air defense costs more than */
  airDefenseCostMax: number;
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
  /** B-TRADE-ODDS: a port's roll for a ship succeeds one time in this many, before its owner's few ports, its misses and a crowded sea count */
  tradeOdds: number;
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
  /** B-EMBARGO-AUTO, in ticks an embargo placed after an attack lasts */
  embargoAutoTicks: number;
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
  /** B-FALLOUT-COST, price of taking a tile under fallout, in % of its usual price */
  falloutCostPercent: number;
  /** B-FALLOUT-TIME, in ticks the land under a heavy missile stays irradiated */
  falloutTicks: number;
  /** B-FALLOUT-TIME-LIGHT, in ticks the land under a light missile stays irradiated; 0 for none */
  lightFalloutTicks: number;
  /** B-MISSILE-TROOPS, troops a strike kills, in % of the share of the land it took */
  missileTroopsPercent: number;
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
  /** B-CAPITAL-RADIUS, in tiles on a map of 2^19 tiles */
  capitalRadius: number;
  /** B-CAPITAL-STRENGTH, percent of the usual price an attacker pays for a tile near a capital */
  capitalStrengthPercent: number;
  /** B-CAPITAL-GARRISON, percent of its owner's soldiers the capital's own tile costs on top */
  capitalGarrisonPercent: number;
  /** B-CAPITAL-SPOILS, percent of a conquered player's troops their conqueror takes; the gold all goes (R-ECO-08) */
  capitalSpoilsPercent: number;
  /** B-CAPITAL-RAZE, percent of their troops a player loses when their capital is razed */
  capitalRazePercent: number;
  /** B-CAPITAL-GRACE, ticks of play before a capital can fall */
  capitalGraceTicks: number;
  /** B-CAPITAL-ALERT, in tiles on a map of 2^19 tiles: an enemy front this close threatens a capital */
  capitalAlert: number;
  /** B-LANDMARK-GOLD, percent more gold from troops for each gold landmark held */
  landmarkGoldPercent: number;
  /** B-LANDMARK-GROWTH, percent faster troop growth for each growth landmark held */
  landmarkGrowthPercent: number;
  /** B-LANDMARK-FORTRESS-RADIUS, in tiles on a map of 2^19 tiles */
  landmarkFortressRadius: number;
  /** B-LANDMARK-FORTRESS, percent of the usual price an attacker pays for a tile near a fortress landmark */
  landmarkFortressPercent: number;
  /** B-LANDMARK-TRADE, percent more gold from each trade ship for each trade landmark held */
  landmarkTradePercent: number;
  /** B-LANDMARK-SHIELD-RADIUS, in tiles on a map of 2^19 tiles */
  landmarkShieldRadius: number;
  /** B-LANDMARK-SHIELD-CHANCE, percent chance a shield landmark stops a missile */
  landmarkShieldChancePercent: number;
  /** B-LANDMARK-ASSAULT, percent less the holder's attacks pay for each tile, for each assault landmark held */
  landmarkAssaultPercent: number;
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
  popBase: 10_000,
  popLand: 200,
  popPerCity: 25_000,
  growthBase: 1,
  growthDivisor: 40,
  goldPerThousandTroops: 0,
  goldBase: 1000,
  desertionBasisPoints: 500,
  workMaxPercent: 80,
  workGoldPercent: 150,
  tileWeightTenths: [80, 100, 120],
  neutralSharePercent: 20,
  botNeutralSharePercent: 10,
  attackSpeedDivisor: 4,
  attackPacePercent: 20,
  attackPaceOddsTenths: 30,
  attackSpread: 4,
  lossBaseThousandths: 463,
  lossDensityThousandths: 39,
  oddsMinPercent: 60,
  oddsMaxPercent: 200,
  largeMidTiles: 300_000,
  largeAttackerPercent: 70,
  largeDefenderPercent: 30,
  botDefensePercent: 70,
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
  cityCost: 125_000,
  fortCost: 50_000,
  portCost: 125_000,
  costGrowthPercent: 200,
  costMax: 1_000_000,
  fortCostMax: 250_000,
  airDefenseCostMax: 3_000_000,
  buildSpacing: 10,
  cityLand: 0,
  fortRadius: 25,
  fortStrengthPercent: 200,
  fortLossPercent: 50,
  tradeRange: 500,
  tradeIntervalTicks: 10,
  tradeMax: 100,
  tradeOdds: 100,
  warshipCost: 250_000,
  warshipMax: 4,
  warshipPatrol: 30,
  warshipRange: 12,
  warshipReloadTicks: 10,
  warshipDamage: 250,
  warshipHealth: 1000,
  warMemoryTicks: 30 * 10,
  embargoNoticeTicks: 30 * 10,
  embargoAutoTicks: 5 * 60 * 10,
  siloCost: 1_000_000,
  airDefenseCost: 1_500_000,
  longBuildTicks: 10 * 10,
  siloReloadTicks: 30 * 10,
  missileCost: 750_000,
  heavyMissileCost: 5_000_000,
  missileRadius: 12,
  heavyMissileRadius: 45,
  missileSpeed: 8,
  falloutCostPercent: 200,
  falloutTicks: 90 * 10,
  lightFalloutTicks: 30 * 10,
  missileTroopsPercent: 300,
  airDefenseRadius: 60,
  airDefenseChancePercent: 75,
  airDefenseReloadTicks: 10 * 10,
  allianceRequestTicks: 20 * 10,
  allianceTicks: 300 * 10,
  allianceRenewTicks: 30 * 10,
  allianceCooldownTicks: 30 * 10,
  traitorTicks: 30 * 10,
  traitorDefensePercent: 50,
  capitalRadius: 15,
  capitalStrengthPercent: 300,
  capitalGarrisonPercent: 20,
  capitalSpoilsPercent: 50,
  capitalRazePercent: 50,
  capitalAlert: 30,
  capitalGraceTicks: 180 * 10,
  landmarkGoldPercent: 20,
  landmarkGrowthPercent: 15,
  landmarkFortressRadius: 12,
  landmarkFortressPercent: 200,
  landmarkTradePercent: 50,
  landmarkShieldRadius: 40,
  landmarkShieldChancePercent: 50,
  landmarkAssaultPercent: 10,
  winSharePercent: 75,
  maxDurationTicks: 3600 * 10,
};
