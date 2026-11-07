/**
 * What a private game can leave out (R-MODE-03), one bit each: a structure
 * by its StructureKind code (bit `1 << kind`), and warships. A palace has no
 * bit of its own and goes with the cities, a mosque with the air defenses: ask `disableBit` for a kind's bit.
 */
export const Disable = {
  City: 1 << 0,
  Fort: 1 << 1,
  Port: 1 << 2,
  Silo: 1 << 3,
  AirDefense: 1 << 4,
  Warships: 1 << 5,
} as const;
/** Every `Disable` bit. */
export const DISABLE_ALL = 0x3f;

/**
 * What the operator of a server may give themselves in their private games,
 * to test (R-MODE-09), one bit each.
 */
export const OperatorBonus = {
  /** Twice the gold from troops, workers and the base income. */
  Gold: 1 << 0,
  /** Twice the population cap and twice the troop growth. */
  Troops: 1 << 1,
  /** Structures at half their price. */
  Building: 1 << 2,
  /** Land twice as costly to take from them. */
  Defense: 1 << 3,
} as const;
/** Every `OperatorBonus` bit. */
export const OPERATOR_BONUS_ALL = 0xf;

/** Special rules a game can be played with (R-MODE-08), all off unless the setup turns them on. */
export interface GameRules {
  /** Capital mode (R-CAP): taking a player's capital conquers them. */
  readonly capitals: boolean;
  /** R-ATTACK-10: outnumbered fronts give way by stretches. */
  readonly collapsingFronts: boolean;
  /** R-DOCTRINE: each player picks one of three doctrines at the start. */
  readonly doctrines: boolean;
}

/** A game with no special rule. */
export const NO_RULES: GameRules = { capitals: false, collapsingFronts: false, doctrines: false };

/** The bit of each special rule in the state hash and the setup digest. */
export const RuleBit = {
  Capitals: 1 << 0,
  CollapsingFronts: 1 << 1,
  Doctrines: 1 << 2,
} as const;

/** Most teams a game can have (R-MODE-02); a team game has 2 or more. */
export const MAX_TEAMS = 4;
