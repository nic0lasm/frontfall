import { capitalAim, capitalAlertDistance, capitalThreat, capitalsStand } from "../capitals.ts";
import { allyError, alliesOf, embargoError, isAllied, isTraitor } from "../diplomacy.ts";
import { populationCap, soldiers } from "../economy.ts";
import { giftError } from "../gifts.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, percentOf } from "../integer-math.ts";
import { MissileSize, missileCost, missileError } from "../missiles.ts";
import {
  StructureKind,
  cityShare,
  disableBit,
  fortRadius,
  placementError,
  structureCost,
  structureCount,
} from "../structures.ts";
import { NEUTRAL } from "../territory/territory-map.ts";
import { BOT_DIFFICULTIES, NATION_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";
import {
  MOOD_BETRAYED,
  MOOD_FRIENDLY,
  MOOD_HOSTILE,
  MOOD_WARY,
  Phrase,
  nationMemory,
} from "./relations.ts";
import {
  RETRY_DECISIONS,
  answerAlliances,
  buildCity,
  buildPort,
  defendCoast,
  inlandSite,
  sail,
  scanBorder,
  persistCooldowns,
  type Cooldowns,
  type OwnerFilter,
} from "./shared.ts";

/** Troops, in % of its population cap, from which a nation attacks as boldly as a bot: its army can grow no more. */
export const NATION_FULL_PERCENT = 90; // B-NATION-FULL

/**
 * Share of its troops at home, in %, a nation puts to work while nobody
 * threatens it and its army is full (R-BOT-15, R-ECO-07).
 */
export const NATION_WORK_PERCENT = 40; // B-NATION-WORK

/** Seconds of play during which a nation opens no front against a player already under attack by `NATION_PILE_MAX` nations, unless that player leads. */
export const NATION_PILE_SECONDS = 600; // B-NATION-PILE-TIME

/** Nations that may attack the same player at once during `NATION_PILE_SECONDS`; the leader is not protected. */
export const NATION_PILE_MAX = 2; // B-NATION-PILE

/** An attack counts as a threat to a nation from this share of the nation's troops: smaller ones do not stop it. */
export const NATION_THREAT_PERCENT = 10; // B-NATION-THREAT

/** Cities a nation owns before it builds a missile silo (R-BOT-12). */
export const NATION_SILO_CITIES = 2; // B-NATION-SILO-CITIES

/** Share of all ownable land, in %, from which the leading player becomes a nation's missile target (R-BOT-12). */
export const NATION_MISSILE_LEADER_PERCENT = 30; // B-NATION-MISSILE-LEADER

/** Allies a nation keeps at most (R-BOT-19). */
export const NATION_ALLIANCE_MAX = 2; // B-NATION-ALLIANCE-MAX

/**
 * A nation allies with a player whose land is under this share of its own,
 * in %, so that the leader cannot buy peace with everyone (R-BOT-19).
 */
export const NATION_ALLIANCE_SIZE_PERCENT = 150; // B-NATION-ALLIANCE-SIZE

/** Border tiles a nation measures the distance to an enemy capital from (R-BOT-17). */
const CAPITAL_SAMPLES = 64;

/**
 * A neighbour whose land is below this share of the nation's own, in %, is
 * down to scraps: the nation looks overseas before it fights them (R-BOT-18).
 */
export const NATION_SCRAPS_PERCENT = 5; // B-NATION-SCRAPS

/** Seconds between two looks of a nation at its neighbours: greetings, embargoes, alliance requests (R-BOT-23). */
export const NATION_COURT_SECONDS = 20; // B-NATION-COURT

/** Seconds between two gifts of a nation to its allies (R-BOT-24). */
export const NATION_GIFT_PAUSE_SECONDS = 60; // B-NATION-GIFT-PAUSE

/** Share of its soldiers, in %, a nation gives an ally in need (R-BOT-24). */
export const NATION_GIFT_PERCENT = 25; // B-NATION-GIFT

/** An ally under attack with troops under this share of its cap, in %, is in need without asking (R-BOT-24). */
export const NATION_NEED_PERCENT = 25; // B-NATION-NEED

/** Seconds between two calls of a nation on its allies to turn on the leader (R-BOT-21). */
const NATION_CALL_SECONDS = 120;

/** Score a nation's view of an ally it eyes drops by at each look (R-BOT-25). */
export const NATION_COVET = 10; // B-NATION-COVET

/** Score at or below which a nation betrays the ally it eyes (R-BOT-25). */
export const NATION_BETRAY_SCORE = -20; // B-NATION-BETRAY-SCORE

/** Seconds a nation keeps turning on the ally it betrayed (R-BOT-25). */
const NATION_PREY_SECONDS = 120;

/** Border tiles a nation looks at to list its neighbours. */
const NEIGHBOUR_SAMPLES = 256;

/** Tiles from the attacker's land within which a nation puts a fort, as far back as it can. */
const FORT_SETBACK = 8;

/**
 * Nations (R-BOT-02, R-BOT-07 to R-BOT-09, R-BOT-14): computer players
 * named after a country, starting on the tile their map gives them (see
 * installSpawn). They play like bots, at their own pace for the difficulty
 * (B-NATION-INTERVAL, B-NATION-ATTACK-RATIO, B-NATION-RESERVE, R-BOT-04),
 * but steadier:
 *
 * - under attack, they hold: no order at all until their troops are above
 *   B-NATION-HOLD of their cap, and then only against the attacker, and they
 *   build a fort facing the attacker when their gold allows;
 * - they attack a player only when the odds favour them (B-NATION-ODDS),
 *   or as a bot would once their army is full (B-NATION-FULL), and fight one
 *   player at a time: while an attack of theirs runs against a player, they
 *   open no front against another one. Free land is always fair game, and
 *   the only target during their first B-NATION-GRACE of play.
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
  const { territory, balance } = game;
  const params = BOT_DIFFICULTIES[difficulty];
  const nationParams = NATION_DIFFICULTIES[difficulty];
  const interval = Math.max(1, nationParams.intervalSeconds * balance.ticksPerSecond);
  const retryTicks = RETRY_DECISIONS * interval;
  const graceTicks = graceSeconds * balance.ticksPerSecond;
  const pileTicks = NATION_PILE_SECONDS * balance.ticksPerSecond;
  const reservePercent = nationParams.reservePercent;
  const topology = game.terrain.topology;
  // R-BOT-16: soldiers' reach along each neighbour's front, reused every decision.
  const facing = new Map<number, number>();
  const around = new Int32Array(4);
  const nations = [...new Set(ids)].sort((a, b) => a - b);
  const nationSet = new Set(nations);
  for (const id of nations) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
  }
  const seaCooldowns: Cooldowns = new Map();
  const cityCooldowns: Cooldowns = new Map();
  const portCooldowns: Cooldowns = new Map();
  const armCooldowns: Cooldowns = new Map();
  const missileCooldowns: Cooldowns = new Map();
  const missilePauseTicks = nationParams.missilePauseSeconds * balance.ticksPerSecond;
  const memory = nationMemory(game, nationSet, `nation memory ${nations.join(",")}`);
  const courtTicks = NATION_COURT_SECONDS * balance.ticksPerSecond;
  const giftPauseTicks = NATION_GIFT_PAUSE_SECONDS * balance.ticksPerSecond;
  persistCooldowns(game, `nations ${difficulty} ${String(graceSeconds)} ${nations.join(",")}`, [
    seaCooldowns,
    cityCooldowns,
    portCooldowns,
    armCooldowns,
    missileCooldowns,
  ]);

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const id of nations) {
      // Offset by id, like bots, so that decisions spread over the interval.
      if ((game.tick + id) % interval !== 0) continue;
      const nation = game.player(id) as Player;
      if (nation.alive) decide(nation);
    }
  });

  /** What spared() knows, computed once per decision: a scan asks about every tile of the border. */
  let pileFresh = false;
  const piled = new Map<number, number>();
  let pileLeader: number = NEUTRAL;

  /**
   * R-BOT-13: whether a nation may open a front against `owner` early on:
   * fewer than `NATION_PILE_MAX` nations are attacking them, or they lead.
   */
  function spared(owner: number): boolean {
    if (!pileFresh) {
      pileFresh = true;
      piled.clear();
      for (const attack of game.attacks) {
        if (attack.target !== NEUTRAL && nationSet.has(attack.player)) {
          piled.set(attack.target, (piled.get(attack.target) ?? 0) + 1);
        }
      }
      pileLeader = leader();
    }
    return (piled.get(owner) ?? 0) < NATION_PILE_MAX || owner === pileLeader;
  }

  /** The player with the most land, the lowest number among equals. */
  function leader(): number {
    let best = NEUTRAL;
    let most = -1;
    for (const player of game.players()) {
      const tiles = territory.tileCount(player.id);
      if (tiles > most) {
        most = tiles;
        best = player.id;
      }
    }
    return best;
  }

  function decide(nation: Player): void {
    pileFresh = false;
    const tiles = territory.tileCount(nation.id);
    if (tiles === 0 || territory.borderCount(nation.id) === 0) return;
    answerAlliances(
      game,
      nation,
      NATION_ALLIANCE_SIZE_PERCENT,
      NATION_ALLIANCE_MAX,
      (other, theirs, ours) => willAlly(nation.id, other, theirs, ours),
      (from, expiresAt) => {
        // Turned down once, when the request is new.
        if (game.tick - (expiresAt - balance.allianceRequestTicks) < interval) {
          memory.say(nation.id, from, Phrase.Down);
        }
      },
    );
    // Once every B-NATION-COURT, spread by id.
    if ((game.tick + id7(nation.id)) % courtTicks < interval) court(nation);
    buildCity(game, nation, cityCooldowns, retryTicks);
    buildPort(game, nation, portCooldowns, retryTicks);
    defendCoast(game, nation);
    arm(nation);
    const cap = populationCap(game, nation);
    // R-BOT-17: a front near its capital comes before any other attacker.
    const besieger = capitalThreat(game, nation.id);
    const attacker = besieger !== NEUTRAL ? besieger : mainAttacker(nation.id);
    // R-BOT-09: one war at a time. Alliances (#47) will narrow this further.
    const enemies = new Set<number>();
    for (const attack of game.attacks) {
      if (attack.player === nation.id && attack.target !== NEUTRAL) enemies.add(attack.target);
    }
    // Troops past the cap would be wasted: a full army takes the odds a bot would.
    const full = nation.troops * 100 >= cap * NATION_FULL_PERCENT;
    // R-BOT-15: at work while full and at peace.
    work(
      nation,
      attacker === NEUTRAL && full && enemies.size === 0 && !exposedAtWork(nation)
        ? NATION_WORK_PERCENT
        : 0,
    );
    const reserve = percentOf(cap, reservePercent);
    // R-ECO-07: only soldiers leave; workers count towards the reserve at home.
    const sendable = (): number =>
      Math.min(
        percentOf(soldiers(nation), nationParams.attackRatioPercent),
        nation.troops - reserve,
        soldiers(nation),
      );
    const troops = sendable();
    // R-BOT-15: everyone back under arms before turning on a player.
    const armed = (): number => {
      work(nation, 0);
      return sendable();
    };

    // R-BOT-08: hold the border, and answer the attacker alone once strong enough.
    const front = attacker === NEUTRAL ? -1 : borderWith(nation, attacker);
    if (front >= 0) {
      // R-BOT-17: a besieged capital gets the first fort; its troops stay home, where they defend it.
      if (besieger !== NEUTRAL && nation.capital !== undefined) buildFort(nation, nation.capital);
      buildFort(nation, front);
      if (nation.troops * 100 <= cap * nationParams.holdPercent) return;
      if (troops >= balance.neutralCost) {
        game.apply(nation.id, { type: "attack", target: capitalAim(game, front), troops });
      }
      return;
    }
    // Less than the price of one tile would come straight back.
    if (troops < balance.neutralCost) return;
    // R-BOT-16: a front about to give way gets everything the nation can send.
    if (game.rules.collapsingFronts && press(nation, armed)) return;

    // R-BOT-09: early on, free land only; an attacker is still answered above (R-BOT-08).
    // So is a nation whose attacker holds no land along its border yet, as when a ship has not landed.
    const settling = game.tick < balance.spawnPhaseTicks + graceTicks || attacker !== NEUTRAL;
    const open: OwnerFilter | undefined =
      enemies.size === 0 ? undefined : (owner) => enemies.has(owner);
    // Its workers come back at once when it fights: its strength is all of its troops.
    const ownDensity = divFloor(nation.troops, tiles);
    // R-BOT-22: a traitor first, at any time, then a player it is hostile to once settled.
    if (revenge(nation, ownDensity, full, settling, armed, open)) return;
    // R-BOT-24: an ally under attack next.
    if (helpAllies(nation, ownDensity, full, settling, cap, reserve, armed, open)) return;
    // R-BOT-20: a friend is left alone, unless it leads (R-BOT-14).
    const unfriendly = (owner: number): boolean => memory.score(nation.id, owner) < MOOD_FRIENDLY;
    const accept: OwnerFilter | undefined = settling
      ? () => false
      : game.tick < pileTicks
        ? (owner) =>
            unfriendly(owner) && (open?.(owner) ?? true) && (enemies.has(owner) || spared(owner))
        : (owner) => unfriendly(owner) && (open?.(owner) ?? true);
    // R-BOT-14: once settled, the leader comes first when it borders the nation and the odds allow.
    if (!settling && hunt(nation, ownDensity, armed, open)) return;
    // R-BOT-17: an enemy capital within reach of its border is worth more than any other target.
    if (!settling && strikeCapital(nation, ownDensity, armed, accept)) return;
    const { neutral, enemy, enemyDensity } = scanBorder(game, nation, accept);
    const odds = full ? params.boldnessPercent : nationParams.oddsPercent;
    const weak = enemy >= 0 && enemyDensity * 100 <= ownDensity * odds;
    // Free land is cheaper than a fight, unless the neighbour is much weaker.
    const muchWeaker = weak && enemyDensity * 200 <= ownDensity * odds;
    const target = neutral >= 0 && !muchWeaker ? neutral : weak ? enemy : -1;
    // R-BOT-18: scraps of a neighbour make no front; a larger prize may lie overseas.
    const scraps =
      enemy >= 0 &&
      target === enemy &&
      territory.tileCount(territory.ownerOf(enemy)) * 100 < tiles * NATION_SCRAPS_PERCENT;
    if (scraps && sail(game, nation, armed(), odds, seaCooldowns, retryTicks, accept)) return;
    if (target >= 0) {
      const sent = target === enemy ? armed() : troops;
      const aim = target >= 0 && target === enemy ? capitalAim(game, target) : target;
      game.apply(nation.id, { type: "attack", target: aim, troops: sent });
    } else sail(game, nation, troops, odds, seaCooldowns, retryTicks, accept);
  }

  /**
   * R-BOT-23: whether the nation allies with `other`: never while wary of
   * them, and with a friend twice as large as a stranger.
   */
  function willAlly(id: number, other: number, theirs: number, ours: number): boolean {
    const score = memory.score(id, other);
    if (score < MOOD_WARY) return false;
    const limit = NATION_ALLIANCE_SIZE_PERCENT * (score >= MOOD_FRIENDLY ? 2 : 1);
    return theirs * 100 < ours * limit;
  }

  /**
   * R-BOT-21 to R-BOT-23, once every B-NATION-COURT: greets new neighbours,
   * places an embargo on the players it is hostile to and lifts it once it
   * no longer is wary of them, and asks one neighbour for an alliance: a
   * friend, one who asked by quick message, or one who fears the same leader.
   */
  function court(nation: Player): void {
    const neighbours = neighboursOf(nation);
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
    covet(nation);
    // Allies and teammates alike (R-BOT-10).
    let allies = 0;
    for (const player of game.players()) {
      if (player.alive && isAllied(game, nation.id, player.id)) allies++;
    }
    if (allies >= NATION_ALLIANCE_MAX) {
      for (const other of neighbours) {
        if (memory.askedToAlly(nation.id, other)) memory.say(nation.id, other, Phrase.Down);
      }
      return;
    }
    const ours = territory.tileCount(nation.id);
    const top = leader();
    const topTiles = territory.tileCount(top);
    // A leader that the hunt would go after (R-BOT-14) makes neighbours friends.
    const feared =
      nationParams.huntPercent > 0 &&
      topTiles * 100 >= game.terrain.ownableCount * nationParams.huntPercent;
    let best = NEUTRAL;
    let bestScore = 0;
    for (const other of neighbours) {
      const player = game.player(other) as Player;
      const score = memory.score(nation.id, other);
      const asked = memory.askedToAlly(nation.id, other);
      const theirs = territory.tileCount(other);
      const willing =
        !isTraitor(game, player) &&
        allyError(game, nation, other) === undefined &&
        willAlly(nation.id, other, theirs, ours);
      if (!willing) {
        if (asked) memory.say(nation.id, other, Phrase.Down);
        continue;
      }
      const common = feared && other !== top && nation.id !== top && score >= 0;
      // B-NATION-COURT-PLAYERS: a smaller player who has not attacked it.
      const offered =
        nationParams.courtPlayersSeconds > 0 &&
        game.tick >= nationParams.courtPlayersSeconds * balance.ticksPerSecond &&
        !nationSet.has(other) &&
        score >= 0 &&
        theirs < ours;
      if (score < MOOD_FRIENDLY && !asked && !common && !offered) continue;
      // The friendliest first, the lowest number among equals.
      if (best === NEUTRAL || score > bestScore) {
        best = other;
        bestScore = score;
      }
    }
    if (best !== NEUTRAL) game.apply(nation.id, { type: "ally", target: best });
  }

  /**
   * R-BOT-25: settled, at peace and with no attack on it, a nation eyes the
   * first of its allies, by number, that borders it with at most
   * B-NATION-BETRAY-LAND of its land and B-NATION-BETRAY-TROOPS of its troops,
   * unless it is still marked a traitor. Its score of that ally drops by
   * B-NATION-COVET at each look; it gives a thumbs down when it turns wary,
   * and at B-NATION-BETRAY-SCORE it says sorry, betrays, and turns on them.
   */
  function covet(nation: Player): void {
    if (game.tick < balance.spawnPhaseTicks + graceTicks || isTraitor(game, nation)) return;
    if (mainAttacker(nation.id) !== NEUTRAL) return;
    for (const attack of game.attacks) {
      if (attack.player === nation.id && attack.target !== NEUTRAL) return;
    }
    const ours = territory.tileCount(nation.id);
    for (const ally of alliesOf(game, nation.id)) {
      const other = game.player(ally) as Player;
      const worth =
        territory.tileCount(ally) * 100 <= ours * nationParams.betrayLandPercent &&
        other.troops * 100 <= nation.troops * nationParams.betrayTroopsPercent &&
        touches(nation, ally);
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

  /** Whether a sample of the nation's border touches `owner`'s land, ally or not. */
  function touches(nation: Player, owner: number): boolean {
    const borders = territory.borderCount(nation.id);
    const stride = Math.max(1, Math.ceil(borders / NEIGHBOUR_SAMPLES));
    for (let i = 0; i < borders; i += stride) {
      const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
      for (let j = 0; j < count; j++) {
        if (territory.ownerOf(around[j] as number) === owner) return true;
      }
    }
    return false;
  }

  /** The living players across a sample of the nation's border, not its allies, in ascending order. */
  function neighboursOf(nation: Player): number[] {
    const found = new Set<number>();
    const borders = territory.borderCount(nation.id);
    const stride = Math.max(1, Math.ceil(borders / NEIGHBOUR_SAMPLES));
    for (let i = 0; i < borders; i += stride) {
      const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
      for (let j = 0; j < count; j++) {
        const owner = territory.ownerOf(around[j] as number);
        if (owner !== nation.id && owner !== NEUTRAL) found.add(owner);
      }
    }
    return [...found]
      .filter((owner) => game.player(owner)?.alive === true && !isAllied(game, nation.id, owner))
      .sort((a, b) => a - b);
  }

  /**
   * R-BOT-22: an attack on a player who betrayed the nation, at any time,
   * whatever war it fights, within its boldness, by land or else by sea;
   * once settled, and at a difficulty with B-NATION-GRUDGE, on a neighbour
   * it is hostile to, within its odds and one war at a time (R-BOT-09).
   * Whether it attacked.
   */
  function revenge(
    nation: Player,
    ownDensity: number,
    full: boolean,
    settling: boolean,
    armed: () => number,
    open: OwnerFilter | undefined,
  ): boolean {
    // R-BOT-25: the ally it betrayed, for a while.
    const prey =
      game.tick < (memory.preyUntil.get(nation.id) ?? 0) ? memory.prey.get(nation.id) : undefined;
    // A traitor comes before the war the nation was fighting.
    const accept = (owner: number): boolean => {
      const score = memory.score(nation.id, owner);
      if (score <= MOOD_BETRAYED || owner === prey) return true;
      return score <= MOOD_HOSTILE && !settling && nationParams.grudge && (open?.(owner) ?? true);
    };
    const { enemy, enemyDensity } = scanBorder(game, nation, accept);
    if (enemy >= 0) {
      const owner = territory.ownerOf(enemy);
      const betrayed = memory.score(nation.id, owner) <= MOOD_BETRAYED || owner === prey;
      const odds = betrayed || full ? params.boldnessPercent : nationParams.oddsPercent;
      if (enemyDensity * 100 > ownDensity * odds) return false;
      game.apply(nation.id, { type: "attack", target: capitalAim(game, enemy), troops: armed() });
      return true;
    }
    // A traitor overseas is worth a ship.
    const traitor = (owner: number): boolean => memory.score(nation.id, owner) <= MOOD_BETRAYED;
    let any = false;
    for (const player of game.players()) any ||= player.alive && traitor(player.id);
    if (!any) return false;
    return sail(game, nation, armed(), params.boldnessPercent, seaCooldowns, retryTicks, traitor);
  }

  /**
   * R-BOT-24: for each of its allies, the lowest number first, an attack on
   * the player attacking that ally the most, when they border the nation and
   * the odds allow, once settled and still one war at a time; or else, at
   * most once every B-NATION-GIFT-PAUSE, B-NATION-GIFT of its soldiers to an
   * ally who asked for help or is under attack with troops under B-NATION-NEED
   * of its cap, from troops above its reserve. Whether it attacked.
   */
  function helpAllies(
    nation: Player,
    ownDensity: number,
    full: boolean,
    settling: boolean,
    cap: number,
    reserve: number,
    armed: () => number,
    open: OwnerFilter | undefined,
  ): boolean {
    const allies = alliesOf(game, nation.id);
    if (allies.length === 0) return false;
    for (const ally of allies) {
      const friend = game.player(ally) as Player;
      const foe = mainFoe(ally);
      const asked = memory.askedForHelp(nation.id, ally);
      if (foe !== NEUTRAL && !settling && (open?.(foe) ?? true)) {
        const { enemy, enemyDensity } = scanBorder(game, nation, (owner) => owner === foe);
        const odds = full ? params.boldnessPercent : nationParams.oddsPercent;
        if (enemy >= 0 && enemyDensity * 100 <= ownDensity * odds) {
          game.apply(nation.id, {
            type: "attack",
            target: capitalAim(game, enemy),
            troops: armed(),
          });
          if (asked) {
            memory.forgetHelp(nation.id, ally);
            memory.say(nation.id, ally, Phrase.Up);
          }
          return true;
        }
      }
      const needy =
        asked ||
        (foe !== NEUTRAL &&
          friend.troops * 100 < populationCap(game, friend) * NATION_NEED_PERCENT);
      if (!needy || game.tick < (memory.lastGift.get(nation.id) ?? 0)) continue;
      // Only from a strong army: never at the cost of its own defense.
      if (nation.troops * 100 < cap * nationParams.holdPercent * 2) continue;
      const troops = Math.min(
        percentOf(soldiers(nation), NATION_GIFT_PERCENT),
        nation.troops - reserve,
      );
      if (troops < balance.neutralCost) continue;
      if (giftError(game, nation, ally, troops, 0) !== undefined) continue;
      game.apply(nation.id, { type: "gift", target: ally, troops, gold: 0 });
      memory.lastGift.set(nation.id, game.tick + giftPauseTicks);
      if (asked) {
        memory.forgetHelp(nation.id, ally);
        memory.say(nation.id, ally, Phrase.Up);
      }
    }
    return false;
  }

  /** The player with the most troops in attacks on `id`'s land who is not the nation's ally; NEUTRAL if none. */
  function mainFoe(id: number): number {
    let foe = NEUTRAL;
    let most = 0;
    const byPlayer = new Map<number, number>();
    for (const attack of game.attacks) {
      if (attack.target !== id || attack.troops <= 0) continue;
      const total = (byPlayer.get(attack.player) ?? 0) + attack.troops;
      byPlayer.set(attack.player, total);
      if (total > most) {
        foe = attack.player;
        most = total;
      }
    }
    return foe;
  }

  /**
   * R-BOT-16: with collapsing fronts (R-ATTACK-10), whether putting
   * B-NATION-WORK of its troops to work would leave a front that half the
   * soldiers of the player across it could overwhelm.
   */
  function exposedAtWork(nation: Player): boolean {
    if (!game.rules.collapsingFronts) return false;
    const tiles = territory.tileCount(nation.id);
    const perTile = divFloor(nation.troops - percentOf(nation.troops, NATION_WORK_PERCENT), tiles);
    facing.clear();
    // Each of the nation's tiles counts once per neighbour, as R-ATTACK-10 counts the front.
    const borders = territory.borderCount(nation.id);
    for (let i = 0; i < borders; i++) {
      const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
      for (let j = 0; j < count; j++) {
        const owner = territory.ownerOf(around[j] as number);
        if (owner === nation.id || owner === NEUTRAL) continue;
        let seen = false;
        for (let k = 0; k < j && !seen; k++)
          seen = territory.ownerOf(around[k] as number) === owner;
        if (!seen) facing.set(owner, (facing.get(owner) ?? 0) + 1);
      }
    }
    for (const [owner, front] of facing) {
      const neighbour = game.player(owner);
      if (!neighbour?.alive || isAllied(game, nation.id, owner)) continue;
      const threat = percentOf(soldiers(neighbour), 50);
      if (threat * 10 >= balance.collapseOddsTenths * Math.max(1, perTile * front)) return true;
    }
    return false;
  }

  /**
   * R-BOT-16: with collapsing fronts (R-ATTACK-10), feeds its attack on a
   * player that is building pressure, so the front breaks before the odds
   * turn. Whether it sent anything.
   */
  function press(nation: Player, armed: () => number): boolean {
    const own = territory.tileCount(nation.id);
    const pushing = game.attacks.find(
      (attack) =>
        attack.player === nation.id &&
        attack.target !== NEUTRAL &&
        attack.pressure > 0 &&
        territory.tileCount(attack.target) > own,
    );
    if (!pushing) return false;
    const target = pushing.target;
    const aim =
      territory.ownerOf(pushing.aim) === target
        ? pushing.aim
        : scanBorder(game, nation, (owner) => owner === target).enemy;
    if (aim < 0) return false;
    const troops = armed();
    if (troops < balance.neutralCost) return false;
    return game.apply(nation.id, { type: "attack", target: aim, troops });
  }

  /**
   * R-BOT-15: puts B-NATION-WORK of the troops at home to work while its
   * army is full and it is at peace, and calls them all back to arms as soon
   * as someone threatens it or it turns on a player.
   */
  function work(nation: Player, share: number): void {
    if (nation.workShare !== share) game.apply(nation.id, { type: "work", share });
  }

  /**
   * R-BOT-14: an attack on the player who is not its ally with the most land,
   * once they hold B-NATION-HUNT of it, from a sample of the border, if their
   * troops per tile are within B-BOT-BOLDNESS of the nation's own. Whether
   * it attacked.
   */
  function hunt(
    nation: Player,
    ownDensity: number,
    armed: () => number,
    open: OwnerFilter | undefined,
  ): boolean {
    if (nationParams.huntPercent === 0) return false;
    let top = NEUTRAL;
    let most = 0;
    for (const player of game.players()) {
      if (player.id === nation.id || !player.alive || isAllied(game, nation.id, player.id))
        continue;
      const tiles = territory.tileCount(player.id);
      if (tiles > most) {
        top = player.id;
        most = tiles;
      }
    }
    if (top === NEUTRAL || territory.tileCount(nation.id) >= most) return false;
    // R-BOT-17: with capitals, a runaway leader is a threat twice as soon.
    const huntShare = game.rules.capitals
      ? divFloor(nationParams.huntPercent, 2)
      : nationParams.huntPercent;
    if (most * 100 < game.terrain.ownableCount * huntShare) return false;
    if (open && !open(top)) return false;
    const { enemy, enemyDensity } = scanBorder(game, nation, (owner) => owner === top);
    if (enemy < 0 || enemyDensity * 100 > ownDensity * params.boldnessPercent) return false;
    game.apply(nation.id, { type: "attack", target: capitalAim(game, enemy), troops: armed() });
    // R-BOT-21: and calls on its allies to join in, now and then.
    if (game.tick >= (memory.lastCall.get(nation.id) ?? 0)) {
      memory.lastCall.set(nation.id, game.tick + NATION_CALL_SECONDS * balance.ticksPerSecond);
      for (const ally of alliesOf(game, nation.id)) {
        if (ally !== top) memory.say(nation.id, ally, Phrase.Leader);
      }
    }
    return true;
  }

  /**
   * R-BOT-17: in capital mode, an attack on the capital of a neighbour not
   * its ally whose capital lies within B-CAPITAL-ALERT of the nation's
   * border, if that neighbour's troops per tile are within its boldness,
   * the lowest player number first. Whether it attacked.
   */
  function strikeCapital(
    nation: Player,
    ownDensity: number,
    armed: () => number,
    accept: OwnerFilter | undefined,
  ): boolean {
    if (!capitalsStand(game)) return false;
    const topology = game.terrain.topology;
    const reach = capitalAlertDistance(game);
    const borders = territory.borderCount(nation.id);
    const stride = Math.max(1, Math.ceil(borders / CAPITAL_SAMPLES));
    for (const player of game.players()) {
      const capital = player.capital;
      if (player.id === nation.id || !player.alive || capital === undefined) continue;
      if (isAllied(game, nation.id, player.id) || (accept && !accept(player.id))) continue;
      let near = false;
      for (let i = 0; i < borders && !near; i += stride) {
        near = topology.distance(territory.borderTile(nation.id, i), capital) <= reach;
      }
      if (!near) continue;
      const { enemy, enemyDensity } = scanBorder(game, nation, (owner) => owner === player.id);
      if (enemy < 0 || enemyDensity * 100 > ownDensity * params.boldnessPercent) continue;
      game.apply(nation.id, { type: "attack", target: capitalAim(game, enemy), troops: armed() });
      return true;
    }
    return false;
  }

  /**
   * R-BOT-12: a silo near its start once it has B-NATION-SILO-CITIES cities
   * and the gold for a missile too; an air defense once a player not its
   * ally owns a silo; and, whenever a silo is loaded and its gold allows, a
   * missile at the city closest to it of its main attacker, or else of the
   * leading player once they hold B-NATION-MISSILE-LEADER of the land.
   */
  function arm(nation: Player): void {
    const start = nation.start;
    if (start === undefined) return;
    // Built around a start it still holds, with a pause after a search that found no room.
    const build = (kind: StructureKind): void => {
      if (!game.allows(disableBit(kind)) || territory.ownerOf(start) !== nation.id) return;
      if (game.tick < (armCooldowns.get(nation.id) ?? 0)) return;
      const tile = inlandSite(game, nation, start);
      if (tile >= 0) game.apply(nation.id, { type: "build", structure: kind, tile });
      else armCooldowns.set(nation.id, game.tick + retryTicks);
    };
    const light = missileCost(game, MissileSize.Light);
    if (
      structureCount(game, nation.id, StructureKind.Silo) === 0 &&
      cityShare(game, nation.id) >= NATION_SILO_CITIES &&
      nation.gold >= structureCost(game, nation.id, StructureKind.Silo) + light
    ) {
      build(StructureKind.Silo);
    }
    const threat = game.structures.some(
      (s) =>
        s.kind === StructureKind.Silo &&
        s.player !== nation.id &&
        !isAllied(game, nation.id, s.player),
    );
    if (
      threat &&
      structureCount(game, nation.id, StructureKind.AirDefense) === 0 &&
      nation.gold >= structureCost(game, nation.id, StructureKind.AirDefense)
    ) {
      build(StructureKind.AirDefense);
    }
    // B-NATION-MISSILE-PAUSE: an easy nation fires seldom, a hard one as often as its silo reloads.
    if (nation.gold < light || game.tick < (missileCooldowns.get(nation.id) ?? 0)) return;
    const target = missileTarget(nation);
    if (target === NEUTRAL) return;
    const topology = game.terrain.topology;
    let city = -1;
    let closest = 0;
    for (const s of game.structures) {
      if (s.player !== target) continue;
      if (s.kind !== StructureKind.City && s.kind !== StructureKind.Palace) continue;
      const distance = topology.squaredDistance(s.tile, start);
      if (city < 0 || distance < closest) {
        city = s.tile;
        closest = distance;
      }
    }
    if (city < 0) return;
    const order = { type: "missile", target: city, size: MissileSize.Light } as const;
    if (missileError(game, nation, city, order.size) !== undefined) return;
    game.apply(nation.id, order);
    missileCooldowns.set(nation.id, game.tick + missilePauseTicks);
  }

  /** The main attacker of the nation, or else the leading player if they hold enough land; NEUTRAL if neither. */
  function missileTarget(nation: Player): number {
    const attacker = mainAttacker(nation.id);
    if (attacker !== NEUTRAL) return attacker;
    let leader = NEUTRAL;
    let most = 0;
    for (const player of game.players()) {
      if (player.id === nation.id || !player.alive || isAllied(game, nation.id, player.id))
        continue;
      const tiles = territory.tileCount(player.id);
      if (tiles > most) {
        leader = player.id;
        most = tiles;
      }
    }
    const share = most * 100;
    return share >= game.terrain.ownableCount * NATION_MISSILE_LEADER_PERCENT ? leader : NEUTRAL;
  }

  /**
   * A tile of `owner` next to the nation's land: from a sample of the border
   * first, then from the whole of it, which only an attack makes worth the cost.
   * -1 when they share no border.
   */
  function borderWith(nation: Player, owner: number): number {
    const { enemy } = scanBorder(game, nation, (other) => other === owner);
    if (enemy >= 0) return enemy;
    const around = new Int32Array(4);
    const topology = game.terrain.topology;
    for (let i = 0; i < territory.borderCount(nation.id); i++) {
      const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        if (territory.ownerOf(tile) === owner) return tile;
      }
    }
    return -1;
  }

  /**
   * The player with the most troops in attacks on the nation's land, or
   * NEUTRAL when nobody's attacks there reach B-NATION-THREAT of its troops:
   * a trickle of small attacks must not keep it from playing.
   */
  function mainAttacker(id: number): number {
    const nation = game.player(id) as Player;
    let attacker = NEUTRAL;
    let most = Math.max(0, percentOf(nation.troops, NATION_THREAT_PERCENT) - 1);
    const byPlayer = new Map<number, number>();
    for (const attack of game.attacks) {
      if (attack.target !== id) continue;
      const total = (byPlayer.get(attack.player) ?? 0) + attack.troops;
      byPlayer.set(attack.player, total);
      // Oldest attack first breaks ties, the same on every client.
      if (total > most) {
        attacker = attack.player;
        most = total;
      }
    }
    return attacker;
  }

  /**
   * R-BOT-08: a fort behind the front with the attacker, on the free inland
   * tile of the nation farthest from the attacker's land within a few tiles,
   * so the first tiles lost do not take it; its radius still covers the front.
   * None while one of its forts, built or being built, already covers it.
   */
  function buildFort(nation: Player, front: number): void {
    const kind = StructureKind.Fort;
    if (!game.allows(disableBit(kind)) || nation.gold < structureCost(game, nation.id, kind))
      return;
    const topology = game.terrain.topology;
    const radius = fortRadius(game);
    for (const s of game.structures) {
      if (s.kind === kind && s.player === nation.id && topology.distance(s.tile, front) <= radius) {
        return;
      }
    }
    let best = -1;
    let bestDistance = 0;
    for (const tile of topology.tilesWithin(front, Math.min(FORT_SETBACK, radius))) {
      if (territory.ownerOf(tile) !== nation.id || territory.isBorder(tile)) continue;
      const distance = topology.distance(tile, front);
      // Row order breaks ties, the same on every client.
      if (best >= 0 && distance <= bestDistance) continue;
      if (placementError(game, nation, kind, tile) !== undefined) continue;
      best = tile;
      bestDistance = distance;
    }
    if (best >= 0) game.apply(nation.id, { type: "build", structure: kind, tile: best });
  }
}

/** Spreads a nation's looks at its neighbours over B-NATION-COURT. */
function id7(id: number): number {
  return id * 7;
}
