import { cheapestTile } from "../../attacks.ts";
import { capitalOf, capitalThreat } from "../../capitals.ts";
import { allyError } from "../../diplomacy.ts";
import { populationCap, soldiers } from "../../economy.ts";
import type { Player } from "../../game.ts";
import { divFloor, percentOf } from "../../integer-math.ts";
import { NEUTRAL } from "../../territory/territory-map.ts";
import { Phrase } from "../relations.ts";
import { answerAlliances, buildCity, buildPort, defendCoast, sail, scanBorder } from "../shared.ts";
import { court, willAlly } from "./alliances.ts";
import {
  NATION_ASK_ODDS,
  NATION_SHIP_ODDS,
  NATION_SHIP_ODDS_ALONE,
  NATION_WORK_FROM_PERCENT,
  NATION_WORK_PERCENT,
} from "./constants.ts";
import {
  borderWith,
  goes,
  id7,
  mainAttacker,
  nationRatios,
  neighboursOf,
  work,
  type NationContext,
} from "./context.ts";
import { arm, buildFort, exposedAtWork, press } from "./defense.ts";
import { NATION_STRATEGIES, type NationTurn } from "./strategies.ts";
import { retaliate } from "./strike.ts";

/**
 * One decision of a nation, every B-NATION-INTERVAL, its phases in order:
 * alliances answered, its neighbours courted, building and arming, work
 * or arms, a fort facing its attacker, a hard nation's answer, free land,
 * a front about to give way, alliances asked, a ship now and then, then,
 * once it has saved up to its reserve and its trigger, the strategies of
 * its difficulty in their order (R-BOT-26 to R-BOT-28). A phase that acts
 * may end the decision.
 */
export function decide(ctx: NationContext, nation: Player): void {
  const { game, territory, balance, params, memory, interval } = ctx;
  const tiles = territory.tileCount(nation.id);
  if (tiles === 0 || territory.borderCount(nation.id) === 0) return;
  answerAlliances(
    game,
    nation,
    0,
    Number.MAX_SAFE_INTEGER,
    (other) => willAlly(ctx, nation, other, true),
    (from, expiresAt) => {
      // Turned down once, when the request is new.
      if (game.tick - (expiresAt - balance.allianceRequestTicks) < interval) {
        memory.say(nation.id, from, Phrase.Down);
      }
    },
  );
  // Once every B-NATION-COURT, spread by id.
  if ((game.tick + id7(nation.id)) % ctx.courtTicks < interval) court(ctx, nation);
  buildCity(game, nation, ctx.cityCooldowns, ctx.retryTicks);
  buildPort(game, nation, ctx.portCooldowns, ctx.retryTicks);
  defendCoast(game, nation);
  arm(ctx, nation);
  const cap = populationCap(game, nation);
  // R-BOT-17: a front near its capital comes before any other attacker.
  const besieger = capitalThreat(game, nation.id);
  const attacker = besieger !== NEUTRAL ? besieger : mainAttacker(ctx, nation.id);
  let fighting = false;
  for (const attack of game.attacks) {
    if (attack.player === nation.id && attack.target !== NEUTRAL) fighting = true;
  }
  // R-BOT-15: at work while its army is near full and it is at peace.
  work(
    ctx,
    nation,
    attacker === NEUTRAL &&
      nation.troops * 100 >= cap * NATION_WORK_FROM_PERCENT &&
      !fighting &&
      !exposedAtWork(ctx, nation)
      ? NATION_WORK_PERCENT
      : 0,
  );
  // R-BOT-26: each nation has its own thresholds, drawn from its number.
  const own = nationRatios(nation.id);
  const reserve = percentOf(cap, own.reserve);
  // R-ECO-07: only soldiers leave; workers count towards the reserve at home.
  const sendable = (): number =>
    Math.max(0, Math.min(nation.troops - reserve, soldiers(game, nation)));
  // R-BOT-15: everyone back under arms before turning on a player.
  const armed = (): number => {
    work(ctx, nation, 0);
    return sendable();
  };
  const cheapest = cheapestTile(balance);

  // R-BOT-08: a fort facing the attacker.
  if (attacker !== NEUTRAL) {
    const front = borderWith(ctx, nation, attacker);
    const capital = capitalOf(ctx.game, nation.id);
    if (besieger !== NEUTRAL && capital !== undefined) buildFort(ctx, nation, capital);
    if (front >= 0) buildFort(ctx, nation, front);
  }
  // R-BOT-27: a hard nation answers an attack at once.
  if (params.answer === "at once" && retaliate(ctx, nation, attacker, armed)) return;

  // R-BOT-26: free land first, sending what lies above the smaller reserve of an expanding nation.
  const { neutral } = scanBorder(game, nation);
  if (neutral >= 0) {
    const troops = Math.max(
      0,
      Math.min(nation.troops - percentOf(cap, own.expand), soldiers(game, nation)),
    );
    if (troops >= cheapest) {
      game.apply(nation.id, { type: "attack", target: neutral, troops });
      return;
    }
  }
  // R-BOT-16: a front about to give way gets everything the nation can send.
  if (game.rules.collapsingFronts && press(ctx, nation, armed)) return;

  // R-BOT-27: its neighbours, the fewest troops first.
  const neighbours = neighboursOf(ctx, nation).sort(
    (a, b) => (game.player(a) as Player).troops - (game.player(b) as Player).troops || a - b,
  );
  // R-BOT-28: alliance requests to its neighbours, now and then.
  for (const other of neighbours) {
    if (game.random.nextInt(0, NATION_ASK_ODDS) !== 0) continue;
    if (allyError(game, nation, other) !== undefined || !willAlly(ctx, nation, other, false)) {
      continue;
    }
    game.apply(nation.id, { type: "ally", target: other });
  }
  // R-BOT-27: now and then a ship, carrying a fifth of its soldiers; held back under attack above easy.
  const holdsShips =
    attacker !== NEUTRAL &&
    (params.answer === "at once" ||
      (params.answer === "after reserve" && game.random.nextInt(0, 2) === 0));
  const shipOdds = neighbours.length === 0 ? NATION_SHIP_ODDS_ALONE : NATION_SHIP_ODDS;
  if (!holdsShips && game.random.nextInt(0, shipOdds) === 0) {
    const sailed = sail(
      game,
      nation,
      divFloor(soldiers(game, nation), 5),
      100,
      ctx.seaCooldowns,
      ctx.retryTicks,
      (owner) => goes(ctx, owner),
    );
    if (sailed && neighbours.length > 0) return;
  }
  // R-BOT-26: saving up to its reserve, then to its trigger, but one time in ten whatever the army.
  if (nation.troops < reserve) return;
  if (params.answer === "after reserve" && retaliate(ctx, nation, attacker, armed)) return;
  if (nation.troops * 100 < cap * own.trigger && game.random.nextInt(0, 10) !== 0) return;

  // R-BOT-27: the strategies of its difficulty, in their order, until one attacks.
  const turn: NationTurn = {
    nation,
    neighbours,
    attacker,
    reserve,
    troops: nation.troops,
    armed,
    sendable,
  };
  for (const strategy of params.strategies) {
    if (NATION_STRATEGIES[strategy](ctx, turn)) return;
  }
}
