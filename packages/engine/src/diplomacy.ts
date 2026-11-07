import { Disable } from "@frontfall/contracts";
import type { Game, Player } from "./game.ts";
import { NEUTRAL } from "./territory/territory-map.ts";
import { recallAttacks } from "./attack-recall.ts";
import { ANY_PHASE, defineOrder } from "./order-rules.ts";
import { below, uint } from "./state/codec.ts";
import { writable } from "./state/lists.ts";
import { SlotValues, partKey, removeWhere } from "./state/parts.ts";

/** Two players at peace until `until` (R-DIPLO-02, R-DIPLO-03). `a` is always the lower id. */
export interface Alliance {
  readonly a: number;
  readonly b: number;
  /** First tick the alliance no longer holds. */
  until: number;
  /** Whether each side asked to renew in the last part of the alliance. */
  renewA: boolean;
  renewB: boolean;
}

/**
 * R-DIPLO-10: 1 for each alliance that is a truce bought by tribute, which
 * stops attacks like an alliance and is none otherwise, and 0 for the
 * others, by the alliance's place in `game.alliances`.
 */
const TRUCES = partKey<SlotValues>("truces");
/**
 * R-DIPLO-09: the first tick each embargo placed after an attack is gone, 0
 * for one placed by order, by the embargo's place in `game.embargoes`.
 */
const EMBARGO_ENDS = partKey<SlotValues>("embargo ends");

/** Whether the alliance at `slot` of `game.alliances` is a truce (R-DIPLO-10). */
function truceAt(game: Game, slot: number): boolean {
  return game.part(TRUCES)?.get(slot) === 1;
}

/** When the embargo at `slot` of `game.embargoes` ends (R-DIPLO-09); 0 for one placed by order. */
function embargoEndAt(game: Game, slot: number): number {
  return game.part(EMBARGO_ENDS)?.get(slot) ?? 0;
}

/** Whether `alliance`, one of `game.alliances`, is a truce bought by tribute rather than an alliance (R-DIPLO-10). */
export function isTruce(game: Game, alliance: Readonly<Alliance>): boolean {
  const slot = game.alliances.indexOf(alliance);
  return slot >= 0 && truceAt(game, slot);
}

/**
 * First tick `embargo`, one of `game.embargoes`, is gone when it was placed
 * after an attack (R-DIPLO-09); 0 for one placed by order, which lasts.
 */
export function embargoUntil(game: Game, embargo: Readonly<Embargo>): number {
  const slot = game.embargoes.indexOf(embargo);
  return slot >= 0 ? embargoEndAt(game, slot) : 0;
}

/**
 * Where an alliance, or a truce, is in its life, from its `until` alone:
 * running, then renewable in its last B-ALLIANCE-RENEWAL (R-DIPLO-03), then
 * ended from `until` on (R-DIPLO-02, R-DIPLO-10). Nothing of it is stored.
 * Queries treat an ended alliance as gone at once; the list drops it at the
 * end of the tick.
 */
export type AllianceState = "running" | "renewable" | "ended";

export function allianceState(game: Game, alliance: Readonly<Alliance>): AllianceState {
  const left = alliance.until - game.tick;
  if (left <= 0) return "ended";
  return left <= game.balance.allianceRenewTicks ? "renewable" : "running";
}

/** An alliance asked for and not answered yet (R-DIPLO-01). */
export interface AllianceRequest {
  readonly from: number;
  readonly to: number;
  /** First tick the request is gone. */
  readonly expiresAt: number;
}

/** A player who may not ask the same player again before `until` (R-DIPLO-01). */
export interface RequestCooldown {
  readonly from: number;
  readonly to: number;
  readonly until: number;
}

/** Player `from` trades nothing with player `to` since tick `since` (R-DIPLO-05). */
export interface Embargo {
  readonly from: number;
  readonly to: number;
  readonly since: number;
}

/**
 * An alliance formed, run out, or broken by `a` (R-DIPLO-04), or an embargo
 * of `a` on `b` started or lifted (R-DIPLO-05): every player is told.
 */
export interface DiplomacyEvent {
  readonly tick: number;
  /**
   * Besides alliances and embargoes: `a` took a trade ship of `b`
   * ("captured"), launched a missile at `b`'s land ("missile"), or stopped a
   * missile of `b` with an air defense ("stopped"), sent `b` troops or
   * gold ("gift"), or sent `b` the quick message `phrase` ("quick"), which
   * only those two are shown. "collapsed": a front of `b` gave way before
   * an attack of `a` around `tile` (R-ATTACK-10). In capital mode (R-CAP),
   * `a` took `b`'s capital and with it all their land ("capital"), or `a`'s
   * capital was razed and moved ("razed", with `b` the same player).
   * "tribute": `a` paid `gold` to `b` for a truce (R-DIPLO-10).
   * "eliminated": `a` took the last tile of `b`, and with it `gold` (R-ECO-08).
   * "landmark": `a` took the landmark numbered `landmark` from `b`, NEUTRAL
   * when nobody held it (R-LAND-03).
   * "trade": a trade ship docked on the port at `tile` and brought `a` `gold`,
   * `b` being the other side of the route (R-UNIT-03); one event for each side.
   */
  readonly type:
    | "allied"
    | "ended"
    | "betrayed"
    | "tribute"
    | "embargo"
    | "lifted"
    | "captured"
    | "missile"
    | "stopped"
    | "gift"
    | "quick"
    | "collapsed"
    | "capital"
    | "razed"
    | "eliminated"
    | "landmark"
    | "trade";
  readonly a: number;
  readonly b: number;
  /** A "quick" event's message, by number (R-DIPLO-07). */
  readonly phrase?: number;
  /** Where a "collapsed" front broke (the tile its attacker took closest to the aim), or the port a "trade" ship docked on. */
  readonly tile?: number;
  /** What an "eliminated" player's taker got (R-ECO-08), or what a "trade" ship brought. */
  readonly gold?: number;
  /** A "landmark" event's landmark, by its index in the map's list. */
  readonly landmark?: number;
}

/** Refusals of diplomacy orders, so that interfaces can tell them apart without parsing text. */
export const DiplomacyError = {
  Early: "diplomacy starts after the spawn phase",
  Player: "no such player in the game",
  Self: "a player cannot ally with themselves",
  Asked: "an alliance request is already waiting",
  Cooldown: "too soon to ask this player again",
  Allied: "already allied",
  Renewal: "the alliance cannot be renewed yet",
  NotAllied: "not allied with this player",
  Ally: "the tile belongs to an ally",
  Teammate: "teammates are allies for the whole game",
  CityState: "city-states take no allies",
  Embargoed: "already under your embargo",
  NotEmbargoed: "not under your embargo",
  Truce: "a truce runs between you: no alliance until it ends",
  Weaker: "only a player with clearly more land takes tribute",
  Poor: "not enough gold for the tribute",
  NoTrade: "the game has no ports, so no trade to cut off",
} as const;

export type DiplomacyError = (typeof DiplomacyError)[keyof typeof DiplomacyError];

/** Why a player id taken from an order is not one, or undefined; the game then says whether that player plays. */
export function playerError(id: number): DiplomacyError | undefined {
  return Number.isSafeInteger(id) ? undefined : DiplomacyError.Player;
}

/** Players on the same team: allies for the whole game (R-MODE-02). */
export function sameTeam(game: Game, a: number, b: number): boolean {
  if (a === b || game.teams === 0) return false;
  const team = game.player(a)?.team ?? 0;
  return team !== 0 && team === game.player(b)?.team;
}

/** Allied by an alliance (R-DIPLO), or teammates (R-MODE-02). */
export function isAllied(game: Game, a: number, b: number): boolean {
  return sameTeam(game, a, b) || allianceOf(game, a, b) !== undefined;
}

export function allianceOf(game: Game, a: number, b: number): Readonly<Alliance> | undefined {
  return game.alliances[allianceSlot(game, a, b)];
}

/** The place in `game.alliances` of the alliance or truce of `a` and `b` that has not ended, or -1. */
function allianceSlot(game: Game, a: number, b: number): number {
  if (a === b) return -1;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const { alliances } = game;
  // A plain loop: border scans ask this about every tile next to a player's land.
  for (let slot = 0; slot < alliances.length; slot++) {
    const alliance = alliances[slot] as Readonly<Alliance>;
    if (alliance.a === low && alliance.b === high && allianceState(game, alliance) !== "ended") {
      return slot;
    }
  }
  return -1;
}

/** Whether two players are held back from each other only by a truce bought by tribute (R-DIPLO-10). */
export function inTruce(game: Game, a: number, b: number): boolean {
  const slot = allianceSlot(game, a, b);
  return slot >= 0 && truceAt(game, slot);
}

/** Price of a tribute from `player` (R-DIPLO-10): grows with their land, so a big empire pays more. */
export function tributePrice(game: Game, player: number): number {
  const { balance } = game;
  return balance.tributeBase + balance.tributePerTile * game.territory.tileCount(player);
}

/** Why `player` cannot pay tribute to `target` now, or undefined (R-DIPLO-10). */
export function tributeError(game: Game, player: Player, target: number): string | undefined {
  if (game.phase !== "play") return DiplomacyError.Early;
  if (target === player.id) return DiplomacyError.Self;
  const to = game.player(target);
  if (!to?.alive) return DiplomacyError.Player;
  if (sameTeam(game, player.id, target)) return DiplomacyError.Teammate;
  if (isAllied(game, player.id, target)) return DiplomacyError.Allied;
  const mine = game.territory.tileCount(player.id);
  const theirs = game.territory.tileCount(target);
  if (theirs * 100 < mine * game.balance.tributeLeadPercent) return DiplomacyError.Weaker;
  if (player.gold < tributePrice(game, player.id)) return DiplomacyError.Poor;
  return undefined;
}

/** Ids of a player's allies, in ascending order; truces (R-DIPLO-10) are not alliances. */
export function alliesOf(game: Game, player: number): number[] {
  return partnersOf(game, player, false);
}

/** Ids of the players in a truce with `player`, in ascending order (R-DIPLO-10). */
export function truceMatesOf(game: Game, player: number): number[] {
  return partnersOf(game, player, true);
}

function partnersOf(game: Game, player: number, truces: boolean): number[] {
  const allies: number[] = [];
  for (const [slot, alliance] of game.alliances.entries()) {
    if (truceAt(game, slot) !== truces || allianceState(game, alliance) === "ended") continue;
    if (alliance.a === player) allies.push(alliance.b);
    else if (alliance.b === player) allies.push(alliance.a);
  }
  return allies.sort((x, y) => x - y);
}

export function requestBetween(
  game: Game,
  from: number,
  to: number,
): Readonly<AllianceRequest> | undefined {
  return game.allianceRequests.find(
    (request) => request.from === from && request.to === to && game.tick < request.expiresAt,
  );
}

/** R-DIPLO-04: a player who broke an alliance defends worse until the mark wears off. */
export function isTraitor(game: Game, player: Player): boolean {
  return game.tick < player.traitorUntil;
}

/** Whether a renewal may be asked for now: in the last part of the alliance (R-DIPLO-03). */
export function canRenew(game: Game, alliance: Readonly<Alliance>): boolean {
  return allianceState(game, alliance) !== "running";
}

/** Why `player` cannot send `ally` to `target` now, or undefined. */
export function allyError(game: Game, player: Player, target: number): string | undefined {
  if (game.phase !== "play") return DiplomacyError.Early;
  if (target === player.id) return DiplomacyError.Self;
  if (!game.player(target)?.alive) return DiplomacyError.Player;
  if (sameTeam(game, player.id, target)) return DiplomacyError.Teammate;
  // R-BOT-29: a city-state is nobody's ally.
  if (game.cityStates.has(player.id) || game.cityStates.has(target))
    return DiplomacyError.CityState;
  const slot = allianceSlot(game, player.id, target);
  const alliance = game.alliances[slot];
  if (alliance && truceAt(game, slot)) return DiplomacyError.Truce;
  if (alliance) {
    const voted = player.id === alliance.a ? alliance.renewA : alliance.renewB;
    return allianceState(game, alliance) === "renewable" && !voted
      ? undefined
      : DiplomacyError.Renewal;
  }
  // Answering the other side's request is always allowed.
  if (requestBetween(game, target, player.id)) return undefined;
  if (requestBetween(game, player.id, target)) return DiplomacyError.Asked;
  // A request that ran out this tick has not turned into a cooldown yet.
  const lapsed = game.allianceRequests.some(
    (r) => r.from === player.id && r.to === target && game.tick >= r.expiresAt,
  );
  const waiting =
    lapsed ||
    game.requestCooldowns.some(
      (c) => c.from === player.id && c.to === target && game.tick < c.until,
    );
  return waiting ? DiplomacyError.Cooldown : undefined;
}

/** Why `player` cannot betray `target` now, or undefined. */
export function betrayError(game: Game, player: Player, target: number): string | undefined {
  if (game.phase !== "play") return DiplomacyError.Early;
  if (!game.player(target)?.alive) return DiplomacyError.Player;
  if (sameTeam(game, player.id, target)) return DiplomacyError.Teammate;
  return isAllied(game, player.id, target) ? undefined : DiplomacyError.NotAllied;
}

/**
 * Whether trade between two players is cut: an embargo of either on the other
 * (R-DIPLO-05, R-DIPLO-09). Only embargoes by order put players at war (R-UNIT-04).
 */
export function embargoed(game: Game, a: number, b: number, byOrderOnly = false): boolean {
  return game.embargoes.some(
    (e, slot) =>
      ((e.from === a && e.to === b) || (e.from === b && e.to === a)) &&
      (!byOrderOnly || embargoEndAt(game, slot) === 0),
  );
}

/**
 * First tick of the oldest embargo placed by order between two players,
 * either way round, or Infinity when there is none: a warship takes trade
 * ships only under an embargo held long enough. Embargoes placed after an
 * attack do not count. One pass by slot, as the trade ships in range of
 * every warship ask it each tick.
 */
export function embargoedByOrderSince(game: Game, a: number, b: number): number {
  const { embargoes } = game;
  let since = Infinity;
  for (let slot = 0; slot < embargoes.length; slot++) {
    const e = embargoes[slot] as Embargo;
    if ((e.from === a && e.to === b) || (e.from === b && e.to === a)) {
      if (embargoEndAt(game, slot) === 0) since = Math.min(since, e.since);
    }
  }
  return since;
}

/** Why `player` cannot start (`on` 1) or lift (`on` 0) an embargo on `target` now, or undefined. */
export function embargoError(
  game: Game,
  player: Player,
  target: number,
  on: number,
): string | undefined {
  if (game.phase !== "play") return DiplomacyError.Early;
  if (on !== 0 && on !== 1) return "invalid embargo switch";
  if (target === player.id) return DiplomacyError.Self;
  if (!game.player(target)?.alive) return DiplomacyError.Player;
  if (sameTeam(game, player.id, target)) return DiplomacyError.Teammate;
  // Without ports there is no trade, and an embargo would only declare a war (R-MODE-03).
  if (on === 1 && !game.allows(Disable.Port)) return DiplomacyError.NoTrade;
  // One that only ran from an attack can be kept for good, or lifted early.
  const held = game.embargoes.some((e) => e.from === player.id && e.to === target);
  const kept = game.embargoes.some(
    (e, slot) => e.from === player.id && e.to === target && embargoEndAt(game, slot) === 0,
  );
  if (on === 1 && kept) return DiplomacyError.Embargoed;
  if (on === 0 && !held) return DiplomacyError.NotEmbargoed;
  return undefined;
}

/**
 * R-DIPLO-01, R-DIPLO-03: `ally` asks for an alliance, accepts the other
 * side's request, or votes to renew a running alliance.
 */
export const ALLY_ORDER = defineOrder("ally", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    playerError(order.target) ?? allyError(game, player, order.target) ?? order,
  execute(game, player, order) {
    const { balance } = game;
    const target = order.target;
    const alliance = writable(game, "alliances")[allianceSlot(game, player.id, target)];
    if (alliance) {
      if (player.id === alliance.a) alliance.renewA = true;
      else alliance.renewB = true;
      if (alliance.renewA && alliance.renewB) {
        alliance.until = game.tick + balance.allianceTicks;
        alliance.renewA = false;
        alliance.renewB = false;
      }
      return;
    }
    const asked = requestBetween(game, target, player.id);
    if (!asked) {
      writable(game, "allianceRequests").push({
        from: player.id,
        to: target,
        expiresAt: game.tick + balance.allianceRequestTicks,
      });
      return;
    }
    removeWhere(writable(game, "allianceRequests"), (r) => r === asked);
    form(game, player.id, target);
  },
});

/** R-DIPLO-10: `tribute` pays its price to `target` for a truce. */
export const TRIBUTE_ORDER = defineOrder("tribute", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    playerError(order.target) ??
    tributeError(game, player, order.target) ?? {
      // tributeError found the receiver in the game.
      to: game.player(order.target) as Player,
      price: tributePrice(game, player.id),
    },
  execute(game, player, { to, price }) {
    player.gold -= price;
    to.gold += price;
    form(game, player.id, to.id, true);
    logEvent(game, {
      tick: game.tick,
      type: "tribute",
      a: player.id,
      b: to.id,
      gold: price,
    });
  },
});

/** R-DIPLO-04: `betray` ends an alliance at once and marks the player who broke it. */
export const BETRAY_ORDER = defineOrder("betray", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    playerError(order.target) ?? betrayError(game, player, order.target) ?? order,
  execute(game, player, order) {
    const { balance } = game;
    const broken = allianceOf(game, player.id, order.target);
    removeWhere(writable(game, "alliances"), (a) => a === broken, game.part(TRUCES));
    player.traitorUntil = game.tick + balance.traitorTicks;
    logEvent(game, { tick: game.tick, type: "betrayed", a: player.id, b: order.target });
    // No asking the betrayed player straight back.
    writable(game, "requestCooldowns").push({
      from: player.id,
      to: order.target,
      until: game.tick + balance.allianceCooldownTicks,
    });
  },
});

/** R-DIPLO-05: `embargo` starts (`on` 1) or lifts (`on` 0) an embargo on `target`'s trade. */
export const EMBARGO_ORDER = defineOrder("embargo", {
  phases: ANY_PHASE,
  validate: (game, player, order) =>
    playerError(order.target) ?? embargoError(game, player, order.target, order.on) ?? order,
  execute(game, player, order) {
    const target = order.target;
    const embargoes = writable(game, "embargoes");
    const ends = game.part(EMBARGO_ENDS);
    const lasting = embargoes.findIndex((e) => e.from === player.id && e.to === target);
    if (order.on === 1 && lasting >= 0) ends?.set(lasting, 0);
    else if (order.on === 1) {
      embargoes.push({ from: player.id, to: target, since: game.tick });
      ends?.push(0);
    } else removeWhere(embargoes, (e) => e.from === player.id && e.to === target, ends);
    logEvent(game, {
      tick: game.tick,
      type: order.on === 1 ? "embargo" : "lifted",
      a: player.id,
      b: target,
    });
  },
});

/**
 * Diplomacy (R-DIPLO-01 to R-DIPLO-05). `ally` asks for an alliance, accepts
 * the other side's request, or votes to renew a running alliance; `betray`
 * ends one at once and marks the player who broke it. Requests, alliances and
 * cooldowns run out on ticks, so every client drops them at the same moment.
 * Queries ignore what has run out, so the rules that run later in the tick
 * agree with the orders of the tick; the lists drop it at the end of that tick.
 */
export function installDiplomacy(game: Game): void {
  const { balance } = game;
  const truces = game.addPart(
    TRUCES,
    new SlotValues(
      game,
      () => game.alliances,
      below(() => 2, "truce"),
    ),
  );
  const ends = game.addPart(EMBARGO_ENDS, new SlotValues(game, () => game.embargoes, uint));

  game.onOrder(ALLY_ORDER);
  game.onOrder(TRIBUTE_ORDER);
  game.onOrder(BETRAY_ORDER);
  game.onOrder(EMBARGO_ORDER);

  // R-DIPLO-09: whoever attacks or lands on a player finds their ports shut to that player.
  game.onApplied((_, player, order) => {
    if (order.type !== "attack" && order.type !== "embark") return;
    if (!game.allows(Disable.Port)) return;
    const victim = game.territory.ownerOf(order.target);
    if (victim === NEUTRAL || victim === player.id || !game.player(victim)?.alive) return;
    if (embargoed(game, victim, player.id)) return;
    writable(game, "embargoes").push({ from: victim, to: player.id, since: game.tick });
    ends.push(game.tick + balance.embargoAutoTicks);
    logEvent(game, { tick: game.tick, type: "embargo", a: victim, b: player.id });
  });

  game.onTick(() => {
    const tick = game.tick;
    const alive = (id: number) => game.player(id)?.alive === true;
    removeWhere(
      writable(game, "embargoes"),
      (e, slot) => {
        const until = ends.get(slot);
        return !alive(e.from) || !alive(e.to) || (until !== 0 && tick >= until);
      },
      ends,
    );
    for (const request of game.allianceRequests) {
      if (tick < request.expiresAt || !alive(request.from) || !alive(request.to)) continue;
      writable(game, "requestCooldowns").push({
        from: request.from,
        to: request.to,
        until: request.expiresAt + balance.allianceCooldownTicks,
      });
    }
    removeWhere(
      writable(game, "allianceRequests"),
      (r) => tick >= r.expiresAt || !alive(r.from) || !alive(r.to),
    );
    for (const alliance of game.alliances) {
      // An alliance with a player who fell ends with them, unremarked.
      const ended = allianceState(game, alliance) === "ended";
      if (!ended || !alive(alliance.a) || !alive(alliance.b)) continue;
      logEvent(game, { tick, type: "ended", a: alliance.a, b: alliance.b });
    }
    removeWhere(
      writable(game, "alliances"),
      (a) => allianceState(game, a) === "ended" || !alive(a.a) || !alive(a.b),
      truces,
    );
    removeWhere(writable(game, "requestCooldowns"), (c) => tick >= c.until);
  });
}

/** R-DIPLO-02: the new allies (or the two of a truce, R-DIPLO-10)' attacks on each other end, and their troops go home as from a retreat. */
function form(game: Game, first: number, second: number, truce = false): void {
  const { balance } = game;
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  removeWhere(
    writable(game, "allianceRequests"),
    (r) => (r.from === high && r.to === low) || (r.from === low && r.to === high),
  );
  // Kept by ascending pair: after every alliance of a lower pair, or of the same pair.
  const alliances = writable(game, "alliances");
  let slot = alliances.length;
  while (slot > 0) {
    const before = alliances[slot - 1] as Alliance;
    if (before.a < low || (before.a === low && before.b <= high)) break;
    slot--;
  }
  alliances.splice(slot, 0, {
    a: low,
    b: high,
    until: game.tick + (truce ? balance.tributeTruceTicks : balance.allianceTicks),
    renewA: false,
    renewB: false,
  });
  game.part(TRUCES)?.insert(slot, truce ? 1 : 0);
  removeWhere(
    writable(game, "embargoes"),
    (e, at) =>
      embargoEndAt(game, at) !== 0 &&
      ((e.from === low && e.to === high) || (e.from === high && e.to === low)),
    game.part(EMBARGO_ENDS),
  );
  if (!truce) logEvent(game, { tick: game.tick, type: "allied", a: low, b: high });
  recallAttacks(game, low, high);
}

/**
 * The events logged since the last call, oldest first, taken out of the log:
 * an interface reads each one once (`game.diplomacyEvents` shows them without
 * taking them).
 */
export function takeDiplomacyEvents(game: Game): DiplomacyEvent[] {
  return writable(game, "diplomacyEvents").splice(0);
}

/** Events kept when nobody reads the log, in a server, a bench or a replay. */
export const DIPLOMACY_LOG_SIZE = 256;

export function logEvent(game: Game, event: DiplomacyEvent): void {
  const log = writable(game, "diplomacyEvents");
  log.push(event);
  if (log.length > DIPLOMACY_LOG_SIZE) log.splice(0, log.length - DIPLOMACY_LOG_SIZE);
}
