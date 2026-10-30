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

/** A nation's ways of choosing whom to attack, tried in its difficulty's order (R-BOT-27). */
export type NationStrategy =
  | "answer"
  | "assist"
  | "hated"
  | "traitor"
  | "crown"
  | "capital"
  | "veryWeak"
  | "juicy"
  | "victim"
  | "weakest"
  | "island";

/**
 * What the difficulty changes for nations (R-BOT-04, R-BOT-26 to R-BOT-28):
 * their pace and population, how they choose and answer attacks, and how they
 * take alliances; each nation draws its own thresholds from its number. Values
 * come from the Bots section of docs/balance.md.
 */
export interface NationParameters {
  /** B-NATION-INTERVAL, in seconds between two decisions */
  intervalSeconds: number;
  /** B-NATION-HUMAN, in % of the times it chooses a player who is neither a nation nor a city-state that it goes on */
  humanPercent: number;
  /** B-NATION-CAP, in % of a player's population cap that a nation holds */
  capPercent: number;
  /** B-NATION-START, in % of a player's starting troops that a nation starts with */
  startPercent: number;
  /** B-NATION-GROWTH, in % of a player's troop growth that a nation has */
  growthPercent: number;
  /** B-NATION-GRACE, in seconds of play during which a nation does not eye its allies */
  graceSeconds: number;
  /** B-NATION-ANSWER: when it answers an attack: at once, once past its reserve, or as one of its strategies */
  answer: "at once" | "after reserve" | "strategy";
  /** B-NATION-STRATEGIES, tried in this order once past its trigger */
  strategies: readonly NationStrategy[];
  /** B-NATION-RETAIN, in % of its strongest neighbour's troops it keeps home; 0 never */
  retainPercent: number;
  /** B-NATION-TOO-WEAK: sends nothing under this % of the target's troops; 0 always sends */
  tooWeakPercent: number;
  /** B-NATION-RUNAWAY, in % of the runner-up's land from which the leader is the crown; 0 never */
  runawayPercent: number;
  /** B-NATION-MISSILE-PAUSE, in seconds from one of its missiles to the next */
  missilePauseSeconds: number;
  /** B-NATION-GRUDGE: whether it turns on a player it is hostile to (R-BOT-22); a traitor always */
  grudge: boolean;
  /** B-NATION-BETRAY-LAND: an ally whose land is at most this % of its own is worth betraying (R-BOT-25) */
  betrayLandPercent: number;
  /** B-NATION-BETRAY-TROOPS: ... and whose troops are at most this % of its own */
  betrayTroopsPercent: number;
  /** B-NATION-CONFUSED: one alliance choice in this many is made at random */
  confusedOdds: number;
  /** B-NATION-THREAT-ALLY: a player whose hand it takes for fear: none, 2.5 times its troops, or more troops and twice its cap */
  threat: "none" | "troops" | "cap";
  /** B-NATION-FRIEND-REFUSE, in % of a friend's hands it still turns down */
  friendRefusePercent: number;
  /** B-NATION-ALLIES: from this many allies, or one more, it takes no other; 0 no limit */
  allianceMax: number;
  /** B-NATION-EARLY, in seconds of play during which it takes most hands */
  earlySeconds: number;
  /** B-NATION-EARLY-ACCEPT, in % of the hands it takes then */
  earlyAcceptPercent: number;
  /** B-NATION-SIMILAR-TROOPS, in % of its troops, plus up to 9, above which a player is about as strong */
  similarTroopsPercent: number;
  /** B-NATION-SIMILAR-LAND, in % of its land, plus up to 9, above which a player with half its troops is too */
  similarLandPercent: number;
}

export const NATION_DIFFICULTIES: Readonly<Record<BotDifficulty, Readonly<NationParameters>>> = {
  easy: {
    intervalSeconds: 8,
    humanPercent: 25,
    capPercent: 50,
    startPercent: 50,
    growthPercent: 90,
    graceSeconds: 0,
    answer: "strategy",
    strategies: ["answer", "assist", "hated", "weakest"],
    retainPercent: 0,
    tooWeakPercent: 0,
    runawayPercent: 0,
    missilePauseSeconds: 600,
    grudge: false,
    betrayLandPercent: 30,
    betrayTroopsPercent: 20,
    confusedOdds: 10,
    threat: "none",
    friendRefusePercent: 0,
    allianceMax: 0,
    earlySeconds: 300,
    earlyAcceptPercent: 90,
    similarTroopsPercent: 60,
    similarLandPercent: 70,
  },
  normal: {
    intervalSeconds: 6,
    humanPercent: 75,
    capPercent: 75,
    startPercent: 75,
    growthPercent: 95,
    graceSeconds: 0,
    answer: "after reserve",
    strategies: ["assist", "hated", "traitor", "crown", "capital", "weakest", "island"],
    retainPercent: 0,
    tooWeakPercent: 0,
    runawayPercent: 300,
    missilePauseSeconds: 120,
    grudge: true,
    betrayLandPercent: 50,
    betrayTroopsPercent: 35,
    confusedOdds: 20,
    threat: "troops",
    friendRefusePercent: 0,
    allianceMax: 4,
    earlySeconds: 180,
    earlyAcceptPercent: 70,
    similarTroopsPercent: 70,
    similarLandPercent: 80,
  },
  hard: {
    intervalSeconds: 5,
    humanPercent: 100,
    capPercent: 100,
    startPercent: 100,
    growthPercent: 100,
    graceSeconds: 0,
    answer: "at once",
    strategies: [
      "assist",
      "traitor",
      "hated",
      "veryWeak",
      "juicy",
      "victim",
      "crown",
      "capital",
      "weakest",
      "island",
    ],
    retainPercent: 75,
    tooWeakPercent: 20,
    runawayPercent: 200,
    missilePauseSeconds: 60,
    grudge: true,
    betrayLandPercent: 70,
    betrayTroopsPercent: 50,
    confusedOdds: 40,
    threat: "cap",
    friendRefusePercent: 17,
    allianceMax: 3,
    earlySeconds: 180,
    earlyAcceptPercent: 50,
    similarTroopsPercent: 75,
    similarLandPercent: 85,
  },
};
