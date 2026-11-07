import { nationDoctrine } from "../doctrines.ts";
import type { Game, Player } from "../game.ts";
import { NATION_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";
import { createNationContext } from "./nations/context.ts";
import { decide } from "./nations/decide.ts";

export {
  NATION_ASK_ODDS,
  NATION_BETRAY_SCORE,
  NATION_COURT_SECONDS,
  NATION_COVET,
  NATION_GIFT_PAUSE_SECONDS,
  NATION_GIFT_PERCENT,
  NATION_MISSILE_LEADER_PERCENT,
  NATION_NEED_PERCENT,
  NATION_SHIP_ODDS,
  NATION_SHIP_ODDS_ALONE,
  NATION_SILO_CITIES,
  NATION_THREAT_PERCENT,
  NATION_WORK_FROM_PERCENT,
  NATION_WORK_PERCENT,
} from "./nations/constants.ts";

/**
 * Nations (R-BOT-02, R-BOT-07, R-BOT-26 to R-BOT-28): computer players named
 * after a country, starting on the tile their map gives them (see
 * installSpawn), on the genre's classic nation rule. Every B-NATION-INTERVAL
 * a nation takes free land first, with what lies above a small reserve; now
 * and then sends a ship; then saves up to its reserve and its trigger and
 * tries, in its difficulty's order, its ways of choosing a target: answering
 * an attack, helping an ally, a grudge, a traitor, the runaway leader, the
 * weakest neighbour, and at hard the very weak, the juiciest and the victim
 * of others. It attacks a player only with more troops than them, and lets
 * a human be B-NATION-HUMAN of the time. It asks and answers alliances by
 * difficulty, builds, and puts troops to work while at peace (R-BOT-15).
 *
 * Like bots, they decide from the game state and the game's Random only,
 * and act through game.apply (R-BOT-03).
 */
export function installNations(
  game: Game,
  ids: readonly number[],
  difficulty: BotDifficulty,
  /** B-NATION-GRACE; tests of later behaviour set it to 0. */
  graceSeconds = NATION_DIFFICULTIES[difficulty].graceSeconds,
): void {
  // Without nations there is nothing to run or keep: no part, so the game saves and hashes as one without the call.
  if (ids.length === 0) return;
  // The phases of a decision live in nations/, sharing one context (ADR 0009).
  const ctx = createNationContext(game, ids, difficulty, graceSeconds);
  const { nations, interval } = ctx;

  game.onTick(() => {
    // R-DOCTRINE-04: nations pick their doctrine on the first tick of the spawn phase.
    if (game.rules.doctrines && game.tick === 0 && game.phase === "spawn") {
      for (const id of nations) {
        const nation = game.player(id) as Player;
        game.apply(id, { type: "doctrine", pick: nationDoctrine(game, nation, difficulty) });
      }
    }
    if (game.phase !== "play") return;
    for (const id of nations) {
      // Offset by id, like bots, so that decisions spread over the interval.
      if ((game.tick + id) % interval !== 0) continue;
      const nation = game.player(id) as Player;
      if (nation.alive) decide(ctx, nation);
    }
  });
}
