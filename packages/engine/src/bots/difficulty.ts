export type BotDifficulty = "easy" | "normal" | "hard";

/**
 * How often and how boldly a bot acts (R-BOT-04). Values come from the Bots
 * section of docs/balance.md; each field names its key there.
 */
export interface BotParameters {
  /** B-BOT-INTERVAL, in seconds between two decisions */
  intervalSeconds: number;
  /** B-BOT-ATTACK-RATIO, in % of the troops at home sent by one order */
  attackRatioPercent: number;
  /** B-BOT-RESERVE, in % of the population cap that never leaves home */
  reservePercent: number;
  /** B-BOT-BOLDNESS: attacks a player whose troop density is at most this % of its own */
  boldnessPercent: number;
}

export const BOT_DIFFICULTIES: Readonly<Record<BotDifficulty, Readonly<BotParameters>>> = {
  easy: { intervalSeconds: 5, attackRatioPercent: 15, reservePercent: 50, boldnessPercent: 100 },
  normal: { intervalSeconds: 5, attackRatioPercent: 15, reservePercent: 40, boldnessPercent: 110 },
  hard: { intervalSeconds: 2, attackRatioPercent: 40, reservePercent: 20, boldnessPercent: 150 },
};

/**
 * What the difficulty changes for nations (R-BOT-04): their own pace, their
 * population, how often they let a player be, and how soon they turn on the
 * leader; each nation draws its own thresholds from its number (R-BOT-26). They take B-BOT-BOLDNESS from the bots. Values
 * come from the Bots section of docs/balance.md.
 */
export interface NationParameters {
  /** B-NATION-INTERVAL, in seconds between two decisions */
  intervalSeconds: number;
  /** B-NATION-HUMAN, in % of the decisions aimed at a player who is no nation that go on to attack */
  humanPercent: number;
  /** B-NATION-CAP, in % of a player's population cap that a nation holds */
  capPercent: number;
  /** B-NATION-GROWTH, in % of a player's troop growth that a nation has */
  growthPercent: number;
  /** B-NATION-GRACE, in seconds of play during which a nation opens no front against a player */
  graceSeconds: number;
  /** B-NATION-ODDS: attacks a player whose troop density is at most this % of its own */
  oddsPercent: number;
  /** B-NATION-HOLD: under attack, sends nothing until its troops pass this % of its population cap */
  holdPercent: number;
  /** B-NATION-HUNT, in % of all ownable land from which the leading player is attacked first; 0 never */
  huntPercent: number;
  /** B-NATION-COURT-PLAYERS, in seconds of play from which it offers an alliance to a smaller player who has not attacked it; 0 never */
  courtPlayersSeconds: number;
  /** B-NATION-MISSILE-PAUSE, in seconds from one of its missiles to the next */
  missilePauseSeconds: number;
  /** B-NATION-GRUDGE: whether it turns on a player it is hostile to once settled (R-BOT-22); a traitor always */
  grudge: boolean;
  /** B-NATION-BETRAY-LAND: an ally whose land is at most this % of its own is worth betraying (R-BOT-25) */
  betrayLandPercent: number;
  /** B-NATION-BETRAY-TROOPS: ... and whose troops are at most this % of its own */
  betrayTroopsPercent: number;
}

export const NATION_DIFFICULTIES: Readonly<Record<BotDifficulty, Readonly<NationParameters>>> = {
  easy: {
    intervalSeconds: 8,
    humanPercent: 25,
    capPercent: 50,
    growthPercent: 90,
    graceSeconds: 0,
    oddsPercent: 10_000,
    holdPercent: 60,
    huntPercent: 0,
    courtPlayersSeconds: 300,
    missilePauseSeconds: 600,
    grudge: false,
    betrayLandPercent: 30,
    betrayTroopsPercent: 20,
  },
  normal: {
    intervalSeconds: 6,
    humanPercent: 75,
    capPercent: 75,
    growthPercent: 95,
    graceSeconds: 0,
    oddsPercent: 10_000,
    holdPercent: 50,
    huntPercent: 20,
    courtPlayersSeconds: 0,
    missilePauseSeconds: 120,
    grudge: true,
    betrayLandPercent: 50,
    betrayTroopsPercent: 35,
  },
  hard: {
    intervalSeconds: 5,
    humanPercent: 100,
    capPercent: 100,
    growthPercent: 100,
    graceSeconds: 0,
    oddsPercent: 10_000,
    holdPercent: 30,
    huntPercent: 20,
    courtPlayersSeconds: 0,
    missilePauseSeconds: 60,
    grudge: true,
    betrayLandPercent: 70,
    betrayTroopsPercent: 50,
  },
};
