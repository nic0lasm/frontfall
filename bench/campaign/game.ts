import { readFileSync } from "node:fs";
import {
  createGame,
  DEFAULT_BALANCE,
  populationCap,
  installCityStates,
  installNations,
  CITY_STATES_PER_NATION,
  Doctrine,
  loadMap,
  type BotDifficulty,
  type GameRules,
  type MapDescription,
  type Terrain,
  type Turn,
} from "@frontfall/engine";
import { HumanPlayer, type HumanStyle } from "../balance/human.ts";
import { StyledPlayer, STYLES, type ProfileName, type ProfilePlayer } from "./profiles.ts";

export interface CampaignSetup {
  readonly map: string;
  readonly seed: number;
  readonly profile: ProfileName;
  readonly difficulty: BotDifficulty;
  readonly minutes: number;
  readonly rules?: Partial<GameRules>;
}

/** The game at one moment: where the player stands, who leads, and why the player held back since the last one. */
export interface CampaignSnapshot {
  readonly minute: number;
  readonly sharePercent: number;
  readonly gold: number;
  /** Troops in % of the player's cap. */
  readonly troopsPercent: number;
  /** The biggest other player: id, nation or city-state, share of the map. */
  readonly leader: number;
  readonly leaderKind: "nation" | "city-state";
  readonly leaderSharePercent: number;
  readonly deadMinutes: number;
  readonly underAttackMinutes: number;
  /** The player's attack decisions since the last snapshot, by reason. */
  readonly reasons: Readonly<Record<string, number>>;
}

/** What one simulated game says about the game, the player and the rules. */
export interface CampaignReport {
  readonly setup: CampaignSetup;
  readonly won: boolean;
  readonly decidedAt?: number;
  readonly winner?: number;
  readonly aliveAtEnd: boolean;
  readonly eliminatedAt?: number;
  readonly finalSharePercent: number;
  /** Not won but alive at the end, first on the map with more than 40 % of it: shown beside the win rate. */
  readonly led: boolean;
  /** Snapshots at 5, 10, 20 and 30 min, and at the end if sooner. */
  readonly timeline: readonly CampaignSnapshot[];
  readonly peakSharePercent: number;
  /** Fun: minutes without any land gained or lost by the player, and its share of the game. */
  readonly deadMinutes: number;
  readonly playedMinutes: number;
  /** Fun: minutes until the player first fights another player, or undefined. */
  readonly firstFightMinute?: number;
  /** Fun: share of the minutes the player was under attack, in %. */
  readonly underAttackPercent: number;
  /** Misclicks refused by the rules / orders sent. */
  readonly refused: number;
  readonly sent: number;
  /** Rules broken: tile conservation, negative or non-integer gold or troops, land owned by a dead player. Troops above the cap are normal: they decay slowly once land is lost. */
  readonly violations: readonly string[];
  /** Undecided at the end with nobody gaining ground for 10 min: a stalemate. */
  readonly stalemate: boolean;
  /** Slowest tick and the 99th percentile, in ms: the engine's cost. */
  readonly tickMaxMs: number;
  readonly tickP99Ms: number;
  /** Cost of the tick that ends the spawn phase, ms: a one-time hitch at the start. */
  readonly startMs: number;
  readonly hash: number;
  readonly ms: number;
}

interface PublishedManifest extends MapDescription {
  readonly nations: readonly { readonly name: string; readonly tile: number }[];
}

const mapsDir = new URL("../../apps/client/public/maps/", import.meta.url);
const loaded = new Map<string, { terrain: Terrain; manifest: PublishedManifest }>();
function publishedMap(id: string): { terrain: Terrain; manifest: PublishedManifest } {
  let map = loaded.get(id);
  if (!map) {
    const manifest = JSON.parse(
      readFileSync(new URL(`${id}.json`, mapsDir), "utf8"),
    ) as PublishedManifest;
    const { terrain } = loadMap(readFileSync(new URL(`${id}.bin`, mapsDir)), manifest);
    map = { terrain, manifest };
    loaded.set(id, map);
  }
  return map;
}

/**
 * Plays one game with a simulated player at id 1 against the map's nations,
 * and watches the rules while it runs: this is the bug hunt as much as the
 * balance measure. Deterministic: the same setup gives the same hash.
 */
export function playCampaignGame(
  setup: CampaignSetup,
  makePlayer?: (
    game: ReturnType<typeof createGame>,
    seed: number,
    avoid: readonly number[],
  ) => ProfilePlayer,
): CampaignReport {
  const began = performance.now();
  const { terrain, manifest } = publishedMap(setup.map);
  const balance = DEFAULT_BALANCE;
  const players = [{ id: 1, name: setup.profile }];
  const nations: number[] = [];
  for (const { name, tile } of manifest.nations) {
    const id = players.length + 1;
    players.push({ id, name, start: tile } as never);
    nations.push(id);
  }
  // After the nations, as the client numbers them.
  const cities: number[] = [];
  for (let i = 0; i < manifest.nations.length * CITY_STATES_PER_NATION; i++) {
    const id = players.length + 1;
    players.push({ id, name: `City ${String(id)}` } as never);
    cities.push(id);
  }
  const game = createGame({
    terrain,
    seed: setup.seed,
    players,
    balance,
    // Doctrines are on by default in 0.9.5, public games included.
    rules: { doctrines: true, ...setup.rules },
  });
  if (cities.length > 0) installCityStates(game, cities);
  installNations(game, nations, setup.difficulty);
  const avoid = manifest.nations.map((n) => n.tile);
  const me: ProfilePlayer = makePlayer
    ? makePlayer(game, setup.seed, avoid)
    : setup.profile === "beginner"
      ? new StyledPlayer(game, 1, STYLES.beginner, setup.seed, avoid)
      : humanProfile(game, setup.profile, setup.seed, avoid);

  const pick = doctrineOf(setup);
  const perMinute = 60 * balance.ticksPerSecond;
  const lastTick = balance.spawnPhaseTicks + setup.minutes * perMinute;
  const ownable = terrain.ownableCount;
  const violations = new Set<string>();
  const flag = (what: string): void => {
    if (violations.size < 20) violations.add(what);
  };
  const stepMs: number[] = [];
  let startMs = 0;
  let decidedAt: number | undefined;
  let eliminatedAt: number | undefined;
  let peak = 0;
  let deadMinutes = 0;
  let underAttackMinutes = 0;
  let firstFight: number | undefined;
  let lastTiles = -1;
  let changedThisMinute = false;
  let attackedThisMinute = false;
  let shareSig = "";
  let sigSince = 0;
  let playMinutesDone = 0;
  const timeline: CampaignSnapshot[] = [];
  let windowDead = 0;
  let windowAttacked = 0;
  let lastReasons = new Map<string, number>();
  const snapshot = (minute: number): void => {
    const p = game.player(1);
    let leader = 0;
    let most = -1;
    for (const q of game.players()) {
      if (q.id === 1 || !q.alive) continue;
      const count = game.territory.tileCount(q.id);
      if (count > most) {
        most = count;
        leader = q.id;
      }
    }
    const reasons: Record<string, number> = {};
    const now = me.reasons ?? new Map<string, number>();
    for (const [why, n] of now) {
      const since = n - (lastReasons.get(why) ?? 0);
      if (since > 0) reasons[why] = since;
    }
    lastReasons = new Map(now);
    timeline.push({
      minute,
      sharePercent: round1((game.territory.tileCount(1) * 100) / ownable),
      gold: p?.gold ?? 0,
      troopsPercent: p ? Math.round((p.troops * 100) / Math.max(1, populationCap(game, p))) : 0,
      leader,
      leaderKind: game.bots.has(leader) ? "city-state" : "nation",
      leaderSharePercent: round1((Math.max(0, most) * 100) / ownable),
      deadMinutes: windowDead,
      underAttackMinutes: windowAttacked,
      reasons,
    });
    windowDead = 0;
    windowAttacked = 0;
  };

  while (game.tick < lastTick) {
    const orders = game.tick === 0 || game.phase === "play" ? me.orders() : [];
    // A beginner never opens the doctrine card: no pick means Balanced.
    if (game.tick === 0 && pick !== undefined) orders.unshift({ type: "doctrine", pick });
    const turn: Turn = { tick: game.tick, orders: orders.map((order) => ({ player: 1, order })) };
    const t0 = performance.now();
    try {
      game.step(turn);
    } catch (error) {
      flag(`exception at tick ${String(game.tick)}: ${String(error)}`);
      break;
    }
    const cost = performance.now() - t0;
    // The step that ends the spawn phase places every player once: counted apart.
    if (game.tick <= balance.spawnPhaseTicks + 1) startMs = Math.max(startMs, cost);
    else stepMs.push(cost);
    if (game.phase !== "play") continue;
    const p = game.player(1);
    if (!p) continue;
    const tiles = game.territory.tileCount(1);
    if (lastTiles >= 0 && tiles !== lastTiles) changedThisMinute = true;
    lastTiles = tiles;
    for (const a of game.attacks) {
      if (a.target === 1 && a.player !== 1) attackedThisMinute = true;
    }
    if (!p.alive && eliminatedAt === undefined) {
      eliminatedAt = (game.tick - balance.spawnPhaseTicks) / perMinute;
      playMinutesDone = Math.max(playMinutesDone, Math.ceil(eliminatedAt));
      break;
    }
    const elapsed = game.tick - balance.spawnPhaseTicks;
    if (elapsed > 0 && elapsed % perMinute === 0) {
      playMinutesDone = elapsed / perMinute;
      if (p.alive) {
        if (!changedThisMinute) {
          deadMinutes++;
          windowDead++;
        }
        if (attackedThisMinute) {
          underAttackMinutes++;
          windowAttacked++;
          firstFight ??= Math.max(0, playMinutesDone - 1);
        }
      }
      changedThisMinute = false;
      attackedThisMinute = false;
      peak = Math.max(peak, (tiles * 100) / ownable);
      // Invariants, once a minute.
      let sum = 0;
      for (const q of game.players()) {
        sum += game.territory.tileCount(q.id);
        if (q.troops < 0 || !Number.isInteger(q.troops))
          flag(`troops of ${String(q.id)}: ${String(q.troops)}`);
        if (q.gold < 0 || !Number.isInteger(q.gold))
          flag(`gold of ${String(q.id)}: ${String(q.gold)}`);
        if (!q.alive && game.territory.tileCount(q.id) > 0)
          flag(`dead player ${String(q.id)} owns land`);
      }
      if (sum > ownable) flag(`tiles owned ${String(sum)} exceed ownable ${String(ownable)}`);
      const sig = game
        .players()
        .map((q) => game.territory.tileCount(q.id))
        .join(",");
      if (sig !== shareSig) {
        shareSig = sig;
        sigSince = playMinutesDone;
      }
      if (SNAPSHOT_MINUTES.includes(playMinutesDone)) snapshot(playMinutesDone);
    }
    if (game.decidedAt !== undefined && decidedAt === undefined) {
      decidedAt = (game.decidedAt - balance.spawnPhaseTicks) / perMinute;
      break;
    }
  }
  if (timeline.at(-1)?.minute !== playMinutesDone) snapshot(playMinutesDone);
  const sorted = [...stepMs].sort((a, b) => a - b);
  const alive = game.player(1)?.alive ?? false;
  const mine = game.territory.tileCount(1);
  const led =
    game.winner !== 1 &&
    alive &&
    mine * 100 > ownable * 40 &&
    game.players().every((q) => q.id === 1 || game.territory.tileCount(q.id) < mine);
  const stalemate = decidedAt === undefined && playMinutesDone - sigSince >= 10;
  return {
    setup,
    won: game.winner === 1,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(game.winner === undefined ? {} : { winner: game.winner }),
    aliveAtEnd: alive,
    ...(eliminatedAt === undefined ? {} : { eliminatedAt }),
    finalSharePercent: (mine * 100) / ownable,
    led,
    timeline,
    peakSharePercent: peak,
    deadMinutes,
    playedMinutes: Math.max(1, playMinutesDone),
    ...(firstFight === undefined ? {} : { firstFightMinute: firstFight }),
    underAttackPercent: (underAttackMinutes * 100) / Math.max(1, playMinutesDone),
    refused: me.refused,
    sent: me.sent,
    violations: [...violations],
    stalemate,
    tickMaxMs: sorted.at(-1) ?? 0,
    startMs,
    tickP99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    hash: game.hash(),
    ms: Math.round(performance.now() - began),
  };
}

const SNAPSHOT_MINUTES = [5, 10, 20, 30];
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Nico plays quicker and a little braver than the bench's reference; a veteran waits for the odds. */
const HUMAN_STYLES: Record<"nico" | "veteran", HumanStyle> = {
  nico: {
    everySeconds: 2,
    ratioPercent: 40,
    keepPercent: 35,
    warPercent: 55,
    oddsPercent: 140,
    allySeconds: 600,
    crushPercent: 300,
  },
  veteran: {
    everySeconds: 1,
    ratioPercent: 30,
    keepPercent: 40,
    warPercent: 60,
    oddsPercent: 160,
    allySeconds: 300,
    crushPercent: 300,
  },
};

function humanProfile(
  game: ConstructorParameters<typeof HumanPlayer>[0],
  profile: "nico" | "veteran",
  seed: number,
  avoid: readonly number[],
): ProfilePlayer {
  const human = new HumanPlayer(game, 1, avoid, seed, HUMAN_STYLES[profile]);
  let sent = 0;
  return {
    orders: () => {
      const orders = human.orders();
      sent += orders.length;
      return orders;
    },
    // HumanPlayer only sends orders the rules accept, so nothing is ever refused.
    refused: 0,
    get sent() {
      return sent;
    },
    reasons: human.reasons,
  };
}

/** The doctrine each profile picks: none for a beginner, the aggressive one for Nico, one per seed for a veteran. */
function doctrineOf(setup: CampaignSetup): number | undefined {
  if (setup.profile === "beginner") return undefined;
  if (setup.profile === "nico") return Doctrine.Conqueror;
  return [Doctrine.Conqueror, Doctrine.Merchant, Doctrine.Bastion][setup.seed % 3];
}
