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
 * What the difficulty changes for nations (R-BOT-04): their own pace, how
 * long they leave players alone, how much they keep at home, and how soon
 * they turn on the leader. They take B-BOT-BOLDNESS from the bots. Values
 * come from the Bots section of docs/balance.md.
 */
export interface NationParameters {
  /** B-NATION-INTERVAL, in seconds between two decisions */
  intervalSeconds: number;
  /** B-NATION-ATTACK-RATIO, in % of the troops at home sent by one order */
  attackRatioPercent: number;
  /** B-NATION-GRACE, in seconds of play during which a nation opens no front against a player */
  graceSeconds: number;
  /** B-NATION-ODDS: attacks a player whose troop density is at most this % of its own */
  oddsPercent: number;
  /** B-NATION-HOLD: under attack, sends nothing until its troops pass this % of its population cap */
  holdPercent: number;
  /** B-NATION-RESERVE, in % of the population cap that never leaves home */
  reservePercent: number;
  /** B-NATION-HUNT, in % of all ownable land from which the leading player is attacked first; 0 never */
  huntPercent: number;
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
    intervalSeconds: 5,
    attackRatioPercent: 15,
    graceSeconds: 300,
    oddsPercent: 80,
    holdPercent: 60,
    reservePercent: 25,
    huntPercent: 0,
    missilePauseSeconds: 240,
    grudge: false,
    betrayLandPercent: 30,
    betrayTroopsPercent: 20,
  },
  normal: {
    intervalSeconds: 1,
    attackRatioPercent: 40,
    graceSeconds: 140,
    oddsPercent: 90,
    holdPercent: 30,
    reservePercent: 40,
    huntPercent: 20,
    missilePauseSeconds: 120,
    grudge: true,
    betrayLandPercent: 50,
    betrayTroopsPercent: 35,
  },
  hard: {
    intervalSeconds: 1,
    attackRatioPercent: 60,
    graceSeconds: 115,
    oddsPercent: 100,
    holdPercent: 30,
    reservePercent: 40,
    huntPercent: 20,
    missilePauseSeconds: 60,
    grudge: true,
    betrayLandPercent: 70,
    betrayTroopsPercent: 50,
  },
};
