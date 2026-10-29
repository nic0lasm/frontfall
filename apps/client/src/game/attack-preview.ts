import { DEFAULT_BALANCE, type Balance } from "@frontfall/engine";
import type { GameUpdate, PlayerView } from "./game-view.ts";

/** What an attack with the current ratio would roughly do, before it is sent. */
export interface AttackPreview {
  /** Owner of the land aimed at, 0 for unclaimed land. */
  target: number;
  /** Soldiers the attack would take. */
  troops: number;
  /** Troops each tile of plains costs to take. */
  perTile: number;
  /** Tiles the attack would take before its troops run out, at most all of the target's. */
  tiles: number;
  /** What those tiles would add to the population cap. */
  capGain: number;
}

/** Troops at home who fight, by the same rounding as the engine (R-ECO-07). */
export function soldiersOf(player: Pick<PlayerView, "troops" | "workShare">): number {
  return player.troops - Math.floor((player.troops * player.workShare) / 100);
}

/**
 * A rough forecast of an attack on `target` with `ratio` % of the soldiers,
 * worked out on the screen from what the update shows: every tile is taken
 * at the price of plains (R-ATTACK-03, R-ATTACK-04), the defender's density
 * holds as their tiles fall, and relief and forts are left out. Undefined
 * when no attack can be aimed there: before play, at one's own land, at an
 * ally, or once the player is out.
 */
export function attackPreview(
  update: GameUpdate,
  target: number,
  ratio: number,
  balance: Balance = DEFAULT_BALANCE,
): AttackPreview | undefined {
  const you = update.players.find((player) => player.id === update.you);
  if (!you?.alive || update.phase !== "play" || update.winner !== undefined) return undefined;
  if (target === you.id) return undefined;
  const { allies, teammates, traitors } = update.diplomacy;
  if (teammates.includes(target) || allies.some((ally) => ally.id === target)) return undefined;
  const defender = target === 0 ? undefined : update.players.find((p) => p.id === target);
  if (target !== 0 && !defender?.alive) return undefined;

  const troops = Math.floor((soldiersOf(you) * Math.min(100, Math.max(0, ratio))) / 100);
  let perTile = balance.neutralCost;
  if (defender && defender.tiles > 0) {
    const density = Math.floor(soldiersOf(defender) / defender.tiles);
    perTile += Math.floor((density * balance.defenseDensityTenths) / 10);
    if (traitors.some((traitor) => traitor.id === target)) {
      perTile = Math.floor((perTile * balance.traitorDefensePercent) / 100);
    }
  }
  perTile = Math.max(1, perTile);
  const reach = Math.floor(troops / perTile);
  const tiles = defender ? Math.min(reach, defender.tiles) : reach;
  return { target, troops, perTile, tiles, capGain: tiles * balance.popPerTile };
}

/** Gold a player earns each second from the base income and troops, trade left out (R-ECO-03, R-ECO-07, B-GOLD-BASE). */
export function goldPerSecond(
  player: Pick<PlayerView, "troops" | "workShare">,
  balance: Balance = DEFAULT_BALANCE,
): number {
  const workers = player.troops - soldiersOf(player);
  const earning = player.troops + workers * (balance.workGoldFactor - 1);
  return (earning * balance.goldPerThousandTroops) / 1000 + balance.goldBase;
}
