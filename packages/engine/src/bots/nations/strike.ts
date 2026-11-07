import { cheapestTile } from "../../attacks.ts";
import { capitalAim } from "../../capitals.ts";
import { isTraitor } from "../../diplomacy.ts";
import { soldiers } from "../../economy.ts";
import type { Player } from "../../game.ts";
import { divFloor } from "../../integer-math.ts";
import { NEUTRAL } from "../../territory/territory-map.ts";
import { sail } from "../shared.ts";
import { borderWith, incomingOn, neighboursOf, spared, type NationContext } from "./context.ts";

/**
 * R-BOT-27: an attack on `owner` with `troops`, by land when they border it,
 * or else a ship with a fifth of its soldiers. A hard nation keeps back
 * B-NATION-RETAIN of its strongest neighbour's troops unless it answers
 * an attack, and sends nothing under B-NATION-TOO-WEAK of the target's.
 * Whether it attacked.
 */
export function strike(
  ctx: NationContext,
  nation: Player,
  owner: number,
  troops: number,
  opponent = false,
): boolean {
  const { game, balance, params, seaCooldowns, retryTicks } = ctx;
  const target = game.player(owner);
  if (!target?.alive) return false;
  const incoming = incomingOn(ctx, nation.id);
  let sent = troops;
  if (params.retainPercent > 0) {
    let strongest = 0;
    for (const id of neighboursOf(ctx, nation)) {
      if (id === owner && opponent) continue;
      if (game.bots.has(id)) continue;
      strongest = Math.max(strongest, (game.player(id) as Player).troops);
    }
    const kept = Math.ceil((strongest * params.retainPercent) / 100);
    sent = Math.min(sent, Math.max(nation.troops - kept, incoming));
  }
  if (sent < cheapestTile(balance)) return false;
  if (incoming === 0 && sent * 100 < target.troops * params.tooWeakPercent) {
    return false;
  }
  const tile = borderWith(ctx, nation, owner);
  if (tile >= 0) {
    return game.apply(nation.id, {
      type: "attack",
      target: capitalAim(game, tile),
      troops: sent,
    });
  }
  return sail(
    game,
    nation,
    Math.min(sent, divFloor(soldiers(game, nation), 5)),
    100,
    seaCooldowns,
    retryTicks,
    (other) => other === owner,
  );
}

/** R-BOT-27: an answer to the main attacker, a hard nation sending at least what comes at it. Whether it attacked. */
export function retaliate(
  ctx: NationContext,
  nation: Player,
  attacker: number,
  armed: () => number,
): boolean {
  const { game, nationSet, params } = ctx;
  if (attacker === NEUTRAL || game.bots.has(attacker)) return false;
  const player = game.player(attacker);
  if (player && !nationSet.has(attacker) && !isTraitor(game, player) && spared(ctx, player))
    return false;
  let troops = armed();
  if (params.answer === "at once") {
    troops = Math.max(troops, Math.min(soldiers(game, nation), incomingOn(ctx, nation.id)));
  }
  return strike(ctx, nation, attacker, troops, true);
}
