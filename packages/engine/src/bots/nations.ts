import { cheapestTile } from "../attacks.ts";
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
import { NATION_DIFFICULTIES, type BotDifficulty, type NationStrategy } from "./difficulty.ts";
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
} from "./shared.ts";

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
const CAPITAL_SAMPLES = 64;

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
  const { territory, balance } = game;
  const nationParams = NATION_DIFFICULTIES[difficulty];
  const interval = Math.max(1, nationParams.intervalSeconds * balance.ticksPerSecond);
  const retryTicks = RETRY_DECISIONS * interval;
  const graceTicks = graceSeconds * balance.ticksPerSecond;
  const topology = game.terrain.topology;
  // R-BOT-16: soldiers' reach along each neighbour's front, reused every decision.
  const facing = new Map<number, number>();
  const around = new Int32Array(4);
  const nations = [...new Set(ids)].sort((a, b) => a - b);
  const nationSet = new Set(nations);
  for (const id of nations) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
  }
  for (const id of nations) {
    game.popFactors.set(id, {
      cap: nationParams.capPercent,
      growth: nationParams.growthPercent,
      start: nationParams.startPercent,
    });
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

  function decide(nation: Player): void {
    const tiles = territory.tileCount(nation.id);
    if (tiles === 0 || territory.borderCount(nation.id) === 0) return;
    answerAlliances(
      game,
      nation,
      0,
      Number.MAX_SAFE_INTEGER,
      (other) => willAlly(nation, other, true),
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
    let fighting = false;
    for (const attack of game.attacks) {
      if (attack.player === nation.id && attack.target !== NEUTRAL) fighting = true;
    }
    // R-BOT-15: at work while its army is near full and it is at peace.
    work(
      nation,
      attacker === NEUTRAL &&
        nation.troops * 100 >= cap * NATION_WORK_FROM_PERCENT &&
        !fighting &&
        !exposedAtWork(nation)
        ? NATION_WORK_PERCENT
        : 0,
    );
    // R-BOT-26: each nation has its own thresholds, drawn from its number.
    const own = nationRatios(nation.id);
    const reserve = percentOf(cap, own.reserve);
    // R-ECO-07: only soldiers leave; workers count towards the reserve at home.
    const sendable = (): number => Math.max(0, Math.min(nation.troops - reserve, soldiers(nation)));
    // R-BOT-15: everyone back under arms before turning on a player.
    const armed = (): number => {
      work(nation, 0);
      return sendable();
    };
    const cheapest = cheapestTile(balance);

    // R-BOT-08: a fort facing the attacker.
    if (attacker !== NEUTRAL) {
      const front = borderWith(nation, attacker);
      if (besieger !== NEUTRAL && nation.capital !== undefined) buildFort(nation, nation.capital);
      if (front >= 0) buildFort(nation, front);
    }
    // R-BOT-27: a hard nation answers an attack at once.
    if (nationParams.answer === "at once" && retaliate(nation, attacker, armed)) return;

    // R-BOT-26: free land first, sending what lies above the smaller reserve of an expanding nation.
    const { neutral } = scanBorder(game, nation);
    if (neutral >= 0) {
      const troops = Math.max(
        0,
        Math.min(nation.troops - percentOf(cap, own.expand), soldiers(nation)),
      );
      if (troops >= cheapest) {
        game.apply(nation.id, { type: "attack", target: neutral, troops });
        return;
      }
    }
    // R-BOT-16: a front about to give way gets everything the nation can send.
    if (game.rules.collapsingFronts && press(nation, armed)) return;

    // R-BOT-27: its neighbours, the fewest troops first.
    const neighbours = neighboursOf(nation).sort(
      (a, b) => (game.player(a) as Player).troops - (game.player(b) as Player).troops || a - b,
    );
    // R-BOT-28: alliance requests to its neighbours, now and then.
    for (const other of neighbours) {
      if (game.random.nextInt(0, NATION_ASK_ODDS) !== 0) continue;
      if (allyError(game, nation, other) !== undefined || !willAlly(nation, other, false)) continue;
      game.apply(nation.id, { type: "ally", target: other });
    }
    // R-BOT-27: now and then a ship, carrying a fifth of its soldiers; held back under attack above easy.
    const holdsShips =
      attacker !== NEUTRAL &&
      (nationParams.answer === "at once" ||
        (nationParams.answer === "after reserve" && game.random.nextInt(0, 2) === 0));
    const shipOdds = neighbours.length === 0 ? NATION_SHIP_ODDS_ALONE : NATION_SHIP_ODDS;
    if (!holdsShips && game.random.nextInt(0, shipOdds) === 0) {
      const sailed = sail(
        game,
        nation,
        divFloor(soldiers(nation), 5),
        100,
        seaCooldowns,
        retryTicks,
        (owner) => goes(owner),
      );
      if (sailed && neighbours.length > 0) return;
    }
    // R-BOT-26: saving up to its reserve, then to its trigger, but one time in ten whatever the army.
    if (nation.troops < reserve) return;
    if (nationParams.answer === "after reserve" && retaliate(nation, attacker, armed)) return;
    if (nation.troops * 100 < cap * own.trigger && game.random.nextInt(0, 10) !== 0) return;

    const troops = nation.troops;
    // R-BOT-27: the first of its neighbours, the fewest troops first, that `find` picks.
    const pick = (find: (owner: Player) => boolean): boolean => {
      for (const id of neighbours) {
        const other = game.player(id) as Player;
        if (find(other) && goes(id) && strike(nation, id, armed())) return true;
      }
      return false;
    };
    const strategies: Record<NationStrategy, () => boolean> = {
      answer: () => retaliate(nation, attacker, armed),
      assist: () => helpAllies(nation, reserve, armed),
      hated: () => hated(nation, armed),
      traitor: () => pick((other) => isTraitor(game, other) && other.troops * 10 < troops * 12),
      crown: () => crown(nation, neighbours, armed),
      capital: () => strikeCapital(nation, armed),
      veryWeak: () =>
        pick(
          (other) =>
            other.troops * 100 < populationCap(game, other) * 15 && other.troops * 10 < troops * 12,
        ),
      juicy: () => juicy(nation, neighbours, armed),
      victim: () =>
        pick(
          (other) => other.troops * 10 <= troops * 12 && incomingOn(other.id) * 2 > other.troops,
        ),
      weakest: () => pick((other) => other.troops < troops),
      island: () =>
        neighbours.length === 0 &&
        sail(game, nation, divFloor(soldiers(nation), 5), 100, seaCooldowns, retryTicks, goes),
    };
    for (const strategy of nationParams.strategies) {
      if (strategies[strategy]()) return;
    }
  }

  /**
   * R-BOT-27: whether the nation turns on `owner` when it chooses to: always
   * a nation, a city-state or a traitor; a player never during B-NATION-GRACE,
   * then only B-NATION-HUMAN of the time.
   */
  function goes(owner: number): boolean {
    const player = game.player(owner);
    if (nationSet.has(owner) || game.bots.has(owner) || (player && isTraitor(game, player))) {
      return true;
    }
    // B-NATION-GRACE: no player is chosen early on.
    if (game.tick < balance.spawnPhaseTicks + graceTicks) return false;
    return game.random.nextInt(0, 100) < nationParams.humanPercent;
  }

  /** Troops in attacks on `id`'s land. */
  function incomingOn(id: number): number {
    let total = 0;
    for (const attack of game.attacks) if (attack.target === id) total += attack.troops;
    return total;
  }

  /**
   * R-BOT-27: an attack on `owner` with `troops`, by land when they border it,
   * or else a ship with a fifth of its soldiers. A hard nation keeps back
   * B-NATION-RETAIN of its strongest neighbour's troops unless it answers
   * an attack, and sends nothing under B-NATION-TOO-WEAK of the target's.
   * Whether it attacked.
   */
  function strike(nation: Player, owner: number, troops: number, opponent = false): boolean {
    const target = game.player(owner);
    if (!target?.alive) return false;
    const incoming = incomingOn(nation.id);
    let sent = troops;
    if (nationParams.retainPercent > 0) {
      let strongest = 0;
      for (const id of neighboursOf(nation)) {
        if (id === owner && opponent) continue;
        if (game.bots.has(id)) continue;
        strongest = Math.max(strongest, (game.player(id) as Player).troops);
      }
      const kept = Math.ceil((strongest * nationParams.retainPercent) / 100);
      sent = Math.min(sent, Math.max(nation.troops - kept, incoming));
    }
    if (sent < cheapestTile(balance)) return false;
    if (incoming === 0 && sent * 100 < target.troops * nationParams.tooWeakPercent) {
      return false;
    }
    const tile = borderWith(nation, owner);
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
      Math.min(sent, divFloor(soldiers(nation), 5)),
      100,
      seaCooldowns,
      retryTicks,
      (other) => other === owner,
    );
  }

  /** R-BOT-27: an answer to the main attacker, a hard nation sending at least what comes at it. Whether it attacked. */
  function retaliate(nation: Player, attacker: number, armed: () => number): boolean {
    if (attacker === NEUTRAL || game.bots.has(attacker)) return false;
    let troops = armed();
    if (nationParams.answer === "at once") {
      troops = Math.max(troops, Math.min(soldiers(nation), incomingOn(nation.id)));
    }
    return strike(nation, attacker, troops, true);
  }

  /**
   * R-BOT-27: the runaway leader, a player with B-NATION-RUNAWAY times the
   * land of the runner-up, when it borders the nation; a normal nation only
   * joins attacks already on them. Whether it attacked.
   */
  function crown(nation: Player, neighbours: readonly number[], armed: () => number): boolean {
    const top = runaway();
    if (top === NEUTRAL || !neighbours.includes(top) || !goes(top)) return false;
    const leaderTroops = (game.player(top) as Player).troops;
    if (nationParams.answer !== "at once" && incomingOn(top) * 10 < leaderTroops) return false;
    if (!strike(nation, top, armed(), true)) return false;
    // R-BOT-21: and calls on its allies to join in, now and then.
    if (game.tick >= (memory.lastCall.get(nation.id) ?? 0)) {
      memory.lastCall.set(nation.id, game.tick + NATION_CALL_SECONDS * balance.ticksPerSecond);
      for (const ally of alliesOf(game, nation.id)) {
        if (ally !== top) memory.say(nation.id, ally, Phrase.Leader);
      }
    }
    return true;
  }

  /** R-BOT-27: the player, city-states aside, with B-NATION-RUNAWAY times the land of the next; NEUTRAL if none. */
  function runaway(): number {
    if (nationParams.runawayPercent === 0 || game.teams > 0) return NEUTRAL;
    let first = NEUTRAL;
    let most = 0;
    let second = 0;
    for (const player of game.players()) {
      if (!player.alive || game.bots.has(player.id)) continue;
      const land = territory.tileCount(player.id);
      if (land > most) {
        second = most;
        most = land;
        first = player.id;
      } else if (land > second) second = land;
    }
    if (first === NEUTRAL || second === 0) return NEUTRAL;
    return most * 100 >= second * nationParams.runawayPercent ? first : NEUTRAL;
  }

  /**
   * R-BOT-27: among the neighbours with at most three quarters of its troops,
   * the one richest in buildings, emptiest of troops and largest, each
   * measured against the others. Whether it attacked.
   */
  function juicy(nation: Player, neighbours: readonly number[], armed: () => number): boolean {
    const candidates = neighbours.filter(
      (id) => (game.player(id) as Player).troops * 4 <= nation.troops * 3,
    );
    if (candidates.length === 0) return false;
    const stats = candidates.map((id) => {
      const player = game.player(id) as Player;
      const cap = Math.max(1, populationCap(game, player));
      let buildings = 0;
      for (const s of game.structures) {
        if (s.player === id && s.kind !== StructureKind.Fort && s.kind !== StructureKind.Silo) {
          buildings++;
        }
      }
      // In thousandths, to stay in integers.
      return {
        id,
        buildings,
        gap: 1000 - divFloor(player.troops * 1000, cap),
        land: territory.tileCount(id),
      };
    });
    const span = (values: number[]) => [Math.min(...values), Math.max(...values)] as const;
    const [b0, b1] = span(stats.map((s) => s.buildings));
    const [g0, g1] = span(stats.map((s) => s.gap));
    const [l0, l1] = span(stats.map((s) => s.land));
    const scaled = (v: number, lo: number, hi: number) =>
      hi > lo ? divFloor((v - lo) * 1000, hi - lo) : 0;
    let best = stats[0] as (typeof stats)[number];
    let bestScore = -1;
    for (const s of stats) {
      const score = scaled(s.buildings, b0, b1) + scaled(s.gap, g0, g1) + scaled(s.land, l0, l1);
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
    return goes(best.id) && strike(nation, best.id, armed());
  }

  /**
   * R-BOT-28: whether the nation allies with `other`, answering their request
   * or asking them. It is now and then confused and answers at random; it
   * nearly always turns down a traitor, and above easy a runaway leader; it
   * takes a much stronger player's hand above easy; it turns down a player it
   * is wary of and takes a friend's; then, unless it has allies enough,
   * it takes most hands early on, and later those of players about as strong.
   * A request is weighed once: an answer to it is drawn from the request itself.
   */
  function willAlly(nation: Player, owner: number, answering: boolean): boolean {
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
    if (roll(nationParams.confusedOdds) === 0) return roll(2) === 0;
    if (isTraitor(game, other) && roll(100) >= 10) return false;
    if (runaway() === owner) return false;
    const strong =
      nationParams.threat === "troops"
        ? other.troops * 10 > nation.troops * 25
        : nationParams.threat === "cap"
          ? other.troops > nation.troops &&
            populationCap(game, other) > populationCap(game, nation) * 2
          : false;
    if (strong) return true;
    const score = memory.score(nation.id, owner);
    if (score < MOOD_WARY) return false;
    if (score >= MOOD_FRIENDLY && roll(100) >= nationParams.friendRefusePercent) return true;
    const allies = alliesOf(game, nation.id).length;
    if (nationParams.allianceMax > 0 && allies >= nationParams.allianceMax + roll(2)) return false;
    const early =
      game.tick < balance.spawnPhaseTicks + nationParams.earlySeconds * balance.ticksPerSecond;
    if (early && roll(100) < nationParams.earlyAcceptPercent) return true;
    // About as strong: troops, or land with half the troops, above a share drawn from a range.
    const out = (id: number) => {
      let total = (game.player(id) as Player).troops;
      for (const attack of game.attacks) if (attack.player === id) total += attack.troops;
      return total;
    };
    const ours = out(nation.id);
    const theirs = out(owner);
    const troopShare = nationParams.similarTroopsPercent + roll(10);
    const landShare = nationParams.similarLandPercent + roll(10);
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
   * R-BOT-22: an attack on a player who betrayed the nation, or on the ally
   * it betrayed for a while, or, at a difficulty with B-NATION-GRUDGE, on a
   * neighbour it is hostile to, by land or else by sea, unless they have
   * three times its troops. Whether it attacked.
   */
  function hated(nation: Player, armed: () => number): boolean {
    const prey =
      game.tick < (memory.preyUntil.get(nation.id) ?? 0) ? memory.prey.get(nation.id) : undefined;
    for (const player of game.players()) {
      if (player.id === nation.id || !player.alive || isAllied(game, nation.id, player.id))
        continue;
      const score = memory.score(nation.id, player.id);
      const hostile =
        score <= MOOD_BETRAYED ||
        player.id === prey ||
        (nationParams.grudge && score <= MOOD_HOSTILE);
      if (!hostile || player.troops > nation.troops * 3 || !goes(player.id)) continue;
      if (strike(nation, player.id, armed())) return true;
    }
    return false;
  }

  /**
   * R-BOT-24: for each of its allies, the lowest number first, an attack on
   * the player attacking that ally the most, for an ally it likes or that
   * asked; or else, at most once every B-NATION-GIFT-PAUSE, B-NATION-GIFT of
   * its soldiers to an ally who asked for help or is under attack with troops
   * under B-NATION-NEED of its cap, from twice its reserve. Whether it attacked.
   */
  function helpAllies(nation: Player, reserve: number, armed: () => number): boolean {
    const allies = alliesOf(game, nation.id);
    if (allies.length === 0) return false;
    for (const ally of allies) {
      const friend = game.player(ally) as Player;
      const foe = mainFoe(ally);
      const asked = memory.askedForHelp(nation.id, ally);
      // Only for an ally it likes, at a foe that is not its own ally.
      const liked = memory.score(nation.id, ally) >= MOOD_FRIENDLY || asked;
      if (foe !== NEUTRAL && foe !== nation.id && liked && !isAllied(game, nation.id, foe)) {
        if (goes(foe) && strike(nation, foe, armed())) {
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
      if (nation.troops < reserve * 2) continue;
      const troops = Math.min(
        percentOf(soldiers(nation), NATION_GIFT_PERCENT),
        nation.troops - reserve,
      );
      if (troops < cheapestTile(balance)) continue;
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
    if (troops < cheapestTile(balance)) return false;
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
   * R-BOT-17: in capital mode, an attack on the capital of a neighbour not
   * its ally whose capital lies within B-CAPITAL-ALERT of the nation's
   * border, if that neighbour has fewer troops than the nation, the lowest
   * player number first. Whether it attacked.
   */
  function strikeCapital(nation: Player, armed: () => number): boolean {
    if (!capitalsStand(game)) return false;
    const topology = game.terrain.topology;
    const reach = capitalAlertDistance(game);
    const borders = territory.borderCount(nation.id);
    const stride = Math.max(1, Math.ceil(borders / CAPITAL_SAMPLES));
    for (const player of game.players()) {
      const capital = player.capital;
      if (player.id === nation.id || !player.alive || capital === undefined) continue;
      if (isAllied(game, nation.id, player.id) || player.troops >= nation.troops) continue;
      let near = false;
      for (let i = 0; i < borders && !near; i += stride) {
        near = topology.distance(territory.borderTile(nation.id, i), capital) <= reach;
      }
      if (!near || !goes(player.id)) continue;
      if (strike(nation, player.id, armed())) return true;
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

/**
 * R-BOT-26: the shares of its population cap a nation acts on, each drawn
 * from its number: it attacks a player from `trigger` of the cap and sends
 * what lies above `reserve`; into free land it keeps only `expand`.
 */
function nationRatios(id: number): { trigger: number; reserve: number; expand: number } {
  return {
    trigger: 50 + ((id * 7919) % 11),
    reserve: 30 + ((id * 104_729) % 11),
    expand: 10 + ((id * 1_299_709) % 11),
  };
}

/** Spreads a nation's looks at its neighbours over B-NATION-COURT. */
function id7(id: number): number {
  return id * 7;
}

/** A draw in [0, 2^32) from the numbers given, the same on every client. */
function hashRoll(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  }
  return h;
}
