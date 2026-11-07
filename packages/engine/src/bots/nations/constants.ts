/* The tunables of nations (R-BOT-12 to R-BOT-28), each named by its B- key where it has one. */

/**
 * Share of its troops at home, in %, a nation puts to work while nobody
 * threatens it and its army is full (R-BOT-15, R-ECO-07).
 */
export const NATION_WORK_PERCENT = 40; // B-NATION-WORK

/** Troops, in % of its population cap, from which a nation at peace puts some to work (R-BOT-15). */
export const NATION_WORK_FROM_PERCENT = 90; // B-NATION-WORK-FROM

/** A nation asks each neighbour for an alliance one decision in this many (R-BOT-28). */
export const NATION_ASK_ODDS = 30; // B-NATION-ASK

/** A nation with land neighbours sends a ship one decision in this many, without them one in `NATION_SHIP_ODDS_ALONE` (R-BOT-27). */
export const NATION_SHIP_ODDS = 10; // B-NATION-SHIP
export const NATION_SHIP_ODDS_ALONE = 5; // B-NATION-SHIP-ALONE

/** An attack counts as a threat to a nation from this share of the nation's troops: smaller ones do not stop it. */
export const NATION_THREAT_PERCENT = 10; // B-NATION-THREAT

/** Cities a nation owns before it builds a missile silo (R-BOT-12). */
export const NATION_SILO_CITIES = 2; // B-NATION-SILO-CITIES

/** Share of all ownable land, in %, from which the leading player becomes a nation's missile target (R-BOT-12). */
export const NATION_MISSILE_LEADER_PERCENT = 30; // B-NATION-MISSILE-LEADER

/** Border tiles a nation measures the distance to an enemy capital from (R-BOT-17). */
export const CAPITAL_SAMPLES = 64;

/** Seconds between two looks of a nation at its neighbours: greetings, embargoes, alliance requests (R-BOT-23). */
export const NATION_COURT_SECONDS = 20; // B-NATION-COURT

/** Seconds between two gifts of a nation to its allies (R-BOT-24). */
export const NATION_GIFT_PAUSE_SECONDS = 60; // B-NATION-GIFT-PAUSE

/** Share of its soldiers, in %, a nation gives an ally in need (R-BOT-24). */
export const NATION_GIFT_PERCENT = 25; // B-NATION-GIFT

/** An ally under attack with troops under this share of its cap, in %, is in need without asking (R-BOT-24). */
export const NATION_NEED_PERCENT = 25; // B-NATION-NEED

/** Seconds between two calls of a nation on its allies to turn on the leader (R-BOT-21). */
export const NATION_CALL_SECONDS = 120;

/** Score a nation's view of an ally it eyes drops by at each look (R-BOT-25). */
export const NATION_COVET = 10; // B-NATION-COVET

/** Score at or below which a nation betrays the ally it eyes (R-BOT-25). */
export const NATION_BETRAY_SCORE = -20; // B-NATION-BETRAY-SCORE

/** Seconds a nation keeps turning on the ally it betrayed (R-BOT-25). */
export const NATION_PREY_SECONDS = 120;

/** Border tiles a nation looks at to list its neighbours. */
export const NEIGHBOUR_SAMPLES = 256;

/** Tiles from the attacker's land within which a nation puts a fort, as far back as it can. */
export const FORT_SETBACK = 8;
