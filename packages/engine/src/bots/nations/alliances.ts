import { alliesOf, embargoError, isTraitor } from "../../diplomacy.ts";
import { populationCap } from "../../economy.ts";
import type { Player } from "../../game.ts";
import { divFloor } from "../../integer-math.ts";
import { StructureKind, disableBit } from "../../structures.ts";
import { NEUTRAL } from "../../territory/territory-map.ts";
import { MOOD_FRIENDLY, MOOD_HOSTILE, MOOD_WARY, Phrase } from "../relations.ts";
import { NATION_BETRAY_SCORE, NATION_COVET, NATION_PREY_SECONDS } from "./constants.ts";
import {
  hashRoll,
  mainAttacker,
  neighboursOf,
  runaway,
  touches,
  type NationContext,
} from "./context.ts";

/**
 * R-BOT-28: whether the nation allies with `other`, answering their request
 * or asking them. It is now and then confused and answers at random; it
 * nearly always turns down a traitor, and above easy a runaway leader; it
 * takes a much stronger player's hand above easy; it turns down a player it
 * is wary of and takes a friend's; then, unless it has allies enough,
 * it takes most hands early on, and later those of players about as strong.
 * A request is weighed once: an answer to it is drawn from the request itself.
 */
export function willAlly(
  ctx: NationContext,
  nation: Player,
  owner: number,
  answering: boolean,
): boolean {
  const { game, territory, balance, params, memory } = ctx;
  const other = game.player(owner);
  if (!other?.alive) return false;
  let salt = game.tick;
  if (answering) {
    const request = game.allianceRequests.find((r) => r.from === owner && r.to === nation.id);
    salt = request?.expiresAt ?? divFloor(game.tick, balance.allianceRequestTicks);
  }
  let draws = 0;
  // A request is answered the same way each time it is weighed; a nation's own asks use the game's draws.
  const roll = (n: number): number =>
    answering ? hashRoll(nation.id, owner, salt, draws++) % n : game.random.nextInt(0, n);
  if (roll(params.confusedOdds) === 0) return roll(2) === 0;
  if (isTraitor(game, other) && roll(100) >= 10) return false;
  if (runaway(ctx) === owner) return false;
  const strong =
    params.threat === "troops"
      ? other.troops * 10 > nation.troops * 25
      : params.threat === "cap"
        ? other.troops > nation.troops &&
          populationCap(game, other) > populationCap(game, nation) * 2
        : false;
  if (strong) return true;
  const score = memory.score(nation.id, owner);
  if (score < MOOD_WARY) return false;
  if (score >= MOOD_FRIENDLY && roll(100) >= params.friendRefusePercent) return true;
  const allies = alliesOf(game, nation.id).length;
  if (params.allianceMax > 0 && allies >= params.allianceMax + roll(2)) return false;
  const early = game.tick < balance.spawnPhaseTicks + params.earlySeconds * balance.ticksPerSecond;
  if (early && roll(100) < params.earlyAcceptPercent) return true;
  // About as strong: troops, or land with half the troops, above a share drawn from a range.
  const out = (id: number) => {
    let total = (game.player(id) as Player).troops;
    for (const attack of game.attacks) if (attack.player === id) total += attack.troops;
    return total;
  };
  const ours = out(nation.id);
  const theirs = out(owner);
  const troopShare = params.similarTroopsPercent + roll(10);
  const landShare = params.similarLandPercent + roll(10);
  return (
    theirs * 100 > ours * troopShare ||
    (territory.tileCount(owner) * 100 > territory.tileCount(nation.id) * landShare &&
      theirs * 2 > ours)
  );
}

/**
 * R-BOT-21 to R-BOT-23, once every B-NATION-COURT: greets new neighbours,
 * places an embargo on the players it is hostile to and lifts it once it
 * no longer is wary of them, and eyes its allies (R-BOT-25).
 */
export function court(ctx: NationContext, nation: Player): void {
  const { game, memory } = ctx;
  const neighbours = neighboursOf(ctx, nation);
  for (const other of neighbours) memory.greet(nation.id, other);
  if (game.allows(disableBit(StructureKind.Port))) {
    for (const player of game.players()) {
      if (player.id === nation.id || !player.alive) continue;
      const score = memory.score(nation.id, player.id);
      const held = game.embargoes.some((e) => e.from === nation.id && e.to === player.id);
      const start = !held && score <= MOOD_HOSTILE;
      const lift = held && score >= MOOD_WARY;
      if (!start && !lift) continue;
      const on = start ? 1 : 0;
      if (embargoError(game, nation, player.id, on) === undefined) {
        game.apply(nation.id, { type: "embargo", target: player.id, on });
      }
    }
  }
  covet(ctx, nation);
}

/**
 * R-BOT-25: settled, at peace and with no attack on it, a nation eyes the
 * first of its allies, by number, that borders it with at most
 * B-NATION-BETRAY-LAND of its land and B-NATION-BETRAY-TROOPS of its troops,
 * unless it is still marked a traitor. Its score of that ally drops by
 * B-NATION-COVET at each look; it gives a thumbs down when it turns wary,
 * and at B-NATION-BETRAY-SCORE it says sorry, betrays, and turns on them.
 */
function covet(ctx: NationContext, nation: Player): void {
  const { game, territory, balance, params, memory, graceTicks } = ctx;
  if (game.tick < balance.spawnPhaseTicks + graceTicks || isTraitor(game, nation)) return;
  if (mainAttacker(ctx, nation.id) !== NEUTRAL) return;
  for (const attack of game.attacks) {
    if (attack.player === nation.id && attack.target !== NEUTRAL) return;
  }
  const ours = territory.tileCount(nation.id);
  for (const ally of alliesOf(game, nation.id)) {
    const other = game.player(ally) as Player;
    const worth =
      territory.tileCount(ally) * 100 <= ours * params.betrayLandPercent &&
      other.troops * 100 <= nation.troops * params.betrayTroopsPercent &&
      touches(ctx, nation, ally);
    if (!worth) continue;
    const before = memory.score(nation.id, ally);
    const after = memory.cool(nation.id, ally, NATION_COVET);
    if (after <= NATION_BETRAY_SCORE) {
      memory.say(nation.id, ally, Phrase.Sorry);
      game.apply(nation.id, { type: "betray", target: ally });
      memory.prey.set(nation.id, ally);
      memory.preyUntil.set(nation.id, game.tick + NATION_PREY_SECONDS * balance.ticksPerSecond);
    } else if (before >= MOOD_WARY && after < MOOD_WARY) {
      memory.say(nation.id, ally, Phrase.Down);
    }
    return;
  }
}
