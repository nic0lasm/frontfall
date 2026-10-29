import { allianceOf } from "../diplomacy.ts";
import type { Game, Order, PersistedPart, Player } from "../game.ts";
import { quickAllowedAt } from "../quick-messages.ts";
import { NEUTRAL } from "../territory/territory-map.ts";

/** How a nation feels about another player (R-BOT-20), from its score. */
export type Mood = "hostile" | "wary" | "neutral" | "friendly";

/** Scores run from -MOOD_MAX to MOOD_MAX, 0 for a player the nation knows nothing of. */
const MOOD_MAX = 100;

/** At or below: hostile (B-NATION-MOOD-HOSTILE). */
export const MOOD_HOSTILE = -50;
/** Below: wary (B-NATION-MOOD-WARY). */
export const MOOD_WARY = -10;
/** At or above: friendly (B-NATION-MOOD-FRIENDLY). */
export const MOOD_FRIENDLY = 25;
/** At or below: the player betrayed the nation, which it does not forgive soon. */
export const MOOD_BETRAYED = -90;

/** Score lost for each attack or landing on the nation's land, down to MOOD_ATTACK_FLOOR (B-NATION-MOOD-ATTACK). */
const MOOD_ATTACK = 10;
/** Attacks alone make a nation hostile, never hateful: that takes a missile or a betrayal. */
const MOOD_ATTACK_FLOOR = -60;
/** Score lost for a missile at the nation's land (B-NATION-MOOD-MISSILE). */
const MOOD_MISSILE = 40;
/** Score every other nation loses towards a player who betrays anyone (B-NATION-MOOD-TRAITOR). */
const MOOD_TRAITOR = 20;
/** Score gained for a gift of at least MOOD_GIFT_SHARE of what the nation has (B-NATION-MOOD-GIFT). */
const MOOD_GIFT = 20;
/** Share, in %, of its troops or gold after a gift that a gift must bring a nation to count (B-NATION-GIFT-SHARE). */
const MOOD_GIFT_SHARE = 5;
/** Score gained when an alliance is formed or renewed (B-NATION-MOOD-ALLIED). */
const MOOD_ALLIED = 15;
/** Score gained for an attack on a player who is attacking the nation (B-NATION-MOOD-HELP). */
const MOOD_HELP = 5;
/** Score an apology brings back, up to 0 (B-NATION-MOOD-SORRY). */
const MOOD_SORRY = 10;
/** Score lost to an angry face, down to wary. */
const MOOD_ANGRY = 5;
/** Seconds for a bad score to heal by one point (B-NATION-MOOD-HEAL). */
const HEAL_SECONDS = 6;
/** Seconds for a good score to fade by one point while not allied (B-NATION-MOOD-FADE). */
const FADE_SECONDS = 20;
/** Quick messages a nation keeps waiting at most; more are dropped. */
const PENDING_MAX = 3;
/** Seconds a request for help or for an alliance by quick message stays in a nation's mind. */
export const ASK_MEMORY_SECONDS = 60;

/** The quick messages (R-DIPLO-07) nations use, by number. */
export const Phrase = {
  Hello: 0,
  Thanks: 1,
  Help: 2,
  Ally: 3,
  LeaveMe: 4,
  Leader: 5,
  Sorry: 6,
  Laugh: 10,
  Up: 8,
  Down: 9,
  Angry: 11,
} as const;

/** One key per (nation, player) pair: player ids stay below MAX_PLAYER_ID. */
const PAIR = 65536;
const pairKey = (nation: number, player: number): number => nation * PAIR + player;

type Writer = Parameters<PersistedPart["save"]>[0];
type Reader = Parameters<PersistedPart["load"]>[0];

/**
 * What nations remember of other players (R-BOT-20 to R-BOT-24): a score
 * per player that orders change as they are carried out and time heals, the
 * players each has greeted, the quick messages waiting to be sent, and the
 * requests for help or alliance it was sent. Kept in snapshots.
 */
export class NationMemory {
  private readonly scores = new Map<number, number>();
  private readonly greeted = new Set<number>();
  /** Tick at which a player asked a nation for help, by pair. */
  private readonly helpAsked = new Map<number, number>();
  /** Tick at which a player asked a nation for an alliance by quick message, by pair. */
  private readonly allyAsked = new Map<number, number>();
  /** Tick of a nation's last call on its allies to turn on the leader, by nation. */
  readonly lastCall = new Map<number, number>();
  /** Tick of a nation's last gift to an ally, by nation. */
  readonly lastGift = new Map<number, number>();
  /** The ally a nation betrayed and turns on, by nation, until the tick its resolve runs out (R-BOT-25). */
  readonly prey = new Map<number, number>();
  readonly preyUntil = new Map<number, number>();
  private readonly pending: { from: number; to: number; phrase: number }[] = [];

  private readonly game: Game;
  private readonly nations: ReadonlySet<number>;

  constructor(game: Game, nations: ReadonlySet<number>) {
    this.game = game;
    this.nations = nations;
  }

  isNation(id: number): boolean {
    return this.nations.has(id);
  }

  score(nation: number, player: number): number {
    return this.scores.get(pairKey(nation, player)) ?? 0;
  }

  mood(nation: number, player: number): Mood {
    const score = this.score(nation, player);
    if (score <= MOOD_HOSTILE) return "hostile";
    if (score < MOOD_WARY) return "wary";
    return score >= MOOD_FRIENDLY ? "friendly" : "neutral";
  }

  /** Adds `delta` to the score, within [floor, MOOD_MAX]; a score already below the floor stays. */
  private change(nation: number, player: number, delta: number, floor = -MOOD_MAX): void {
    if (!this.nations.has(nation) || nation === player || player === NEUTRAL) return;
    const before = this.score(nation, player);
    const after =
      delta < 0
        ? Math.min(before, Math.max(floor, before + delta))
        : Math.min(MOOD_MAX, before + delta);
    if (after === before) return;
    this.set(nation, player, after);
    // R-BOT-21: a player who turns a nation against them hears of it.
    if (delta < 0) {
      if (before > MOOD_HOSTILE && after <= MOOD_HOSTILE) this.say(nation, player, Phrase.Angry);
      else if (before >= MOOD_WARY && after < MOOD_WARY) this.say(nation, player, Phrase.LeaveMe);
    }
  }

  private set(nation: number, player: number, score: number): void {
    const key = pairKey(nation, player);
    if (score === 0) this.scores.delete(key);
    else this.scores.set(key, score);
  }

  /**
   * R-BOT-25: a nation that eyes an ally grows cold towards them, without a
   * word: the warning comes from the nation itself. The new score.
   */
  cool(nation: number, player: number, delta: number): number {
    const after = Math.max(-MOOD_MAX, this.score(nation, player) - delta);
    this.set(nation, player, after);
    return after;
  }

  /** R-BOT-21: queues a quick message from a nation to a player who is not a nation. */
  say(nation: number, player: number, phrase: number): void {
    if (this.nations.has(player) || !this.game.player(player)?.alive) return;
    let waiting = 0;
    for (const message of this.pending) {
      if (message.from !== nation) continue;
      if (message.to === player && message.phrase === phrase) return;
      waiting++;
    }
    if (waiting < PENDING_MAX) this.pending.push({ from: nation, to: player, phrase });
  }

  /** Greets a player who is not a nation, once per game. */
  greet(nation: number, player: number): void {
    const key = pairKey(nation, player);
    if (this.nations.has(player) || this.greeted.has(key)) return;
    this.greeted.add(key);
    this.say(nation, player, Phrase.Hello);
  }

  /** Whether `player` asked `nation` for help within ASK_MEMORY_SECONDS. */
  askedForHelp(nation: number, player: number): boolean {
    return this.recent(this.helpAsked.get(pairKey(nation, player)));
  }

  /** Whether `player` asked `nation` for an alliance by quick message within ASK_MEMORY_SECONDS. */
  askedToAlly(nation: number, player: number): boolean {
    return this.recent(this.allyAsked.get(pairKey(nation, player)));
  }

  forgetHelp(nation: number, player: number): void {
    this.helpAsked.delete(pairKey(nation, player));
  }

  private recent(tick: number | undefined): boolean {
    const memory = ASK_MEMORY_SECONDS * this.game.balance.ticksPerSecond;
    return tick !== undefined && this.game.tick - tick < memory;
  }

  /** What an order carried out does to the nations' scores (R-BOT-20). */
  observe(player: Player, order: Order): void {
    const game = this.game;
    switch (order.type) {
      case "attack":
      case "embark": {
        const target = game.territory.ownerOf(order.target);
        if (target === NEUTRAL) return;
        this.change(target, player.id, -MOOD_ATTACK, MOOD_ATTACK_FLOOR);
        // An attack on whoever attacks a nation is help to that nation.
        for (const attack of game.attacks) {
          if (attack.player === target && attack.target !== player.id) {
            this.change(attack.target, player.id, MOOD_HELP);
          }
        }
        return;
      }
      case "missile":
        this.change(game.territory.ownerOf(order.target), player.id, -MOOD_MISSILE);
        return;
      case "betray":
        for (const nation of this.nations) {
          if (nation === order.target) this.change(nation, player.id, -2 * MOOD_MAX);
          else this.change(nation, player.id, -MOOD_TRAITOR, MOOD_ATTACK_FLOOR);
        }
        return;
      case "gift": {
        const to = game.player(order.target);
        if (!to || !this.nations.has(to.id)) return;
        // The gift is already in: a share of what the nation has now.
        const counts =
          order.troops * 100 >= to.troops * MOOD_GIFT_SHARE ||
          order.gold * 100 >= to.gold * MOOD_GIFT_SHARE;
        if (!counts) return;
        this.change(to.id, player.id, MOOD_GIFT);
        this.say(to.id, player.id, Phrase.Thanks);
        return;
      }
      case "ally": {
        const alliance = allianceOf(game, player.id, order.target);
        // Formed or renewed by this very order: it runs for the full duration.
        if (!alliance || alliance.until !== game.tick + game.balance.allianceTicks) return;
        this.change(order.target, player.id, MOOD_ALLIED);
        this.change(player.id, order.target, MOOD_ALLIED);
        if (this.nations.has(player.id)) this.say(player.id, order.target, Phrase.Up);
        else if (this.nations.has(order.target)) this.say(order.target, player.id, Phrase.Up);
        return;
      }
      case "quick": {
        const nation = order.target;
        if (!this.nations.has(nation) || this.nations.has(player.id)) return;
        const score = this.score(nation, player.id);
        if (order.phrase === Phrase.Sorry && score < 0) {
          this.set(nation, player.id, Math.min(0, score + MOOD_SORRY));
        } else if (order.phrase === Phrase.Angry) {
          this.change(nation, player.id, -MOOD_ANGRY, MOOD_WARY);
        } else if (order.phrase === Phrase.Help) {
          this.helpAsked.set(pairKey(nation, player.id), game.tick);
        } else if (order.phrase === Phrase.Ally) {
          this.allyAsked.set(pairKey(nation, player.id), game.tick);
        } else if (order.phrase === Phrase.Hello) {
          this.greet(nation, player.id);
        }
        return;
      }
      case "spawn":
      case "retreat":
      case "build":
      case "demolish":
      case "embargo":
      case "warship":
      case "patrol":
      case "work":
        return;
    }
  }

  /** Heals bad scores and fades good ones, and sends each nation's next quick message when it may. */
  tick(): void {
    const game = this.game;
    const tps = game.balance.ticksPerSecond;
    const heal = game.tick % (HEAL_SECONDS * tps) === 0;
    const fade = game.tick % (FADE_SECONDS * tps) === 0;
    if (heal || fade) {
      for (const [key, score] of [...this.scores]) {
        if (score < 0 && heal) this.set(Math.floor(key / PAIR), key % PAIR, score + 1);
        else if (score > 0 && fade && !allianceOf(game, Math.floor(key / PAIR), key % PAIR)) {
          this.set(Math.floor(key / PAIR), key % PAIR, score - 1);
        }
      }
    }
    if (this.pending.length === 0) return;
    // One message per nation and tick, oldest first; a nation still waiting keeps its turn.
    const turnTaken = new Set<number>();
    for (let i = 0; i < this.pending.length;) {
      const message = this.pending[i] as { from: number; to: number; phrase: number };
      if (!game.player(message.from)?.alive || !game.player(message.to)?.alive) {
        this.pending.splice(i, 1);
        continue;
      }
      if (turnTaken.has(message.from) || game.tick < quickAllowedAt(game, message.from)) {
        turnTaken.add(message.from);
        i++;
        continue;
      }
      turnTaken.add(message.from);
      this.pending.splice(i, 1);
      game.apply(message.from, { type: "quick", target: message.to, phrase: message.phrase });
    }
  }

  save(out: Writer): void {
    const writeMap = (map: ReadonlyMap<number, number>): void => {
      const entries = [...map].sort(([a], [b]) => a - b);
      out.uint(entries.length);
      for (const [key, value] of entries) {
        out.uint(key);
        out.int(value);
      }
    };
    writeMap(this.scores);
    const greeted = [...this.greeted].sort((a, b) => a - b);
    out.uint(greeted.length);
    for (const key of greeted) out.uint(key);
    writeMap(this.helpAsked);
    writeMap(this.allyAsked);
    writeMap(this.lastCall);
    writeMap(this.lastGift);
    writeMap(this.prey);
    writeMap(this.preyUntil);
    out.uint(this.pending.length);
    for (const { from, to, phrase } of this.pending) {
      out.uint(from);
      out.uint(to);
      out.uint(phrase);
    }
  }

  load(from: Reader): void {
    const readMap = (map: Map<number, number>): void => {
      map.clear();
      for (let n = from.count(); n > 0; n--) map.set(from.uint(), from.int());
    };
    readMap(this.scores);
    this.greeted.clear();
    for (let n = from.count(); n > 0; n--) this.greeted.add(from.uint());
    readMap(this.helpAsked);
    readMap(this.allyAsked);
    readMap(this.lastCall);
    readMap(this.lastGift);
    readMap(this.prey);
    readMap(this.preyUntil);
    this.pending.length = 0;
    for (let n = from.count(); n > 0; n--) {
      this.pending.push({ from: from.uint(), to: from.uint(), phrase: from.uint() });
    }
  }
}

const memories = new WeakMap<Game, NationMemory>();

/** The nations' memory of a game, made on first use and kept in snapshots (R-BOT-20). */
export function nationMemory(game: Game, nations: ReadonlySet<number>, name: string): NationMemory {
  const existing = memories.get(game);
  if (existing) return existing;
  const memory = new NationMemory(game, nations);
  memories.set(game, memory);
  game.onApplied((_, player, order) => {
    memory.observe(player, order);
  });
  game.onTick(() => {
    if (game.phase === "play") memory.tick();
  });
  game.persist(name, {
    save(out) {
      memory.save(out);
    },
    load(from) {
      memory.load(from);
    },
  });
  return memory;
}

/** How nation `nation` feels about `player` (R-BOT-20); undefined when `nation` is not a nation of this game. */
export function nationMood(game: Game, nation: number, player: number): Mood | undefined {
  const memory = memories.get(game);
  return memory?.isNation(nation) ? memory.mood(nation, player) : undefined;
}
