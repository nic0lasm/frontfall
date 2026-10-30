import { DEFAULT_BALANCE, type Balance } from "@frontfall/engine";
import type { GameUpdate, PlayerView } from "./game-view.ts";

/** What an attack with the current ratio would roughly do, before it is sent. */
export interface AttackPreview {
  /** Owner of the land aimed at, 0 for unclaimed land. */
  target: number;
  /** Soldiers the attack would take. */
  troops: number;
  /** Troops each tile of plains costs to take, to a tenth. */
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
 * at the price of plains (R-ATTACK-03, R-ATTACK-04) against the odds the
 * whole attack faces, the defender's density holds as their tiles fall, and
 * relief, forts and bots are left out. Undefined when no attack can be aimed
 * there: before play, at one's own land, at an ally, or once the player is out.
 */
export function attackPreview(
  update: GameUpdate,
  target: number,
  ratio: number,
  balance: Balance = DEFAULT_BALANCE,
): AttackPreview | undefined {
  const you = update.players.find((player) => player.id === update.you);
  if (!you?.alive || update.phase !== "play") return undefined;
  if (target === you.id) return undefined;
  const { allies, teammates, traitors } = update.diplomacy;
  if (teammates.includes(target) || allies.some((ally) => ally.id === target)) return undefined;
  const defender = target === 0 ? undefined : update.players.find((p) => p.id === target);
  if (target !== 0 && !defender?.alive) return undefined;

  const troops = Math.floor((soldiersOf(you) * Math.min(100, Math.max(0, ratio))) / 100);
  const weight = balance.tileWeightTenths[0] / 10;
  let perTile = (weight * balance.neutralSharePercent) / 100;
  if (defender && defender.tiles > 0) {
    const defending = soldiersOf(defender);
    const odds = Math.min(
      balance.oddsMaxPercent / 100,
      Math.max(balance.oddsMinPercent / 100, defending / Math.max(1, troops)),
    );
    const large = (tiles: number, percent: number): number =>
      1 - percent / 100 / (1 + Math.pow(balance.largeMidTiles / Math.max(1, tiles), 2.5));
    const sizes =
      large(you.tiles, balance.largeAttackerPercent) *
      large(defender.tiles, balance.largeDefenderPercent);
    perTile =
      (weight *
        odds *
        (balance.lossBaseThousandths * sizes +
          (balance.lossDensityThousandths * defending) / defender.tiles)) /
      1000;
    if (traitors.some((traitor) => traitor.id === target)) {
      perTile = (perTile * balance.traitorDefensePercent) / 100;
    }
  }
  perTile = Math.max(0.1, Math.round(perTile * 10) / 10);
  const reach = Math.floor(troops / perTile);
  const tiles = defender ? Math.min(reach, defender.tiles) : reach;
  // R-ECO-01: the land's share of the cap grows with its 0.6 power, so each tile adds less to a large empire.
  const land = (count: number): number => Math.floor(Math.pow(count, 0.6) * balance.popLand);
  return { target, troops, perTile, tiles, capGain: land(you.tiles + tiles) - land(you.tiles) };
}

/**
 * Gold a player earns each second, trade left out (R-ECO-03, R-ECO-07): the
 * fixed income, B-WORK-GOLD more of it for the share of their cap at work.
 */
export function goldPerSecond(
  player: Pick<PlayerView, "troops" | "workShare" | "cap">,
  balance: Balance = DEFAULT_BALANCE,
): number {
  const workers = player.troops - soldiersOf(player);
  const share = player.cap > 0 ? Math.min(workers, player.cap) / player.cap : 0;
  const idle = ((player.troops - workers) * balance.goldPerThousandTroops) / 1000;
  return balance.goldBase * (1 + (share * balance.workGoldPercent) / 100) + idle;
}
