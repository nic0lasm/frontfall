import { readFileSync } from "node:fs";
import {
  createGame,
  DEFAULT_BALANCE,
  installNations,
  loadMap,
  type BotDifficulty,
  type GameRules,
  type MapDescription,
  type Terrain,
  type Turn,
} from "@frontfall/engine";
import { StyledPlayer, STYLES, type ProfileName, type ProfilePlayer } from "./profiles.ts";

export interface CampaignSetup {
  readonly map: string;
  readonly seed: number;
  readonly profile: ProfileName;
  readonly difficulty: BotDifficulty;
  readonly minutes: number;
  readonly rules?: Partial<GameRules>;
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
  /** Rules broken: tile conservation, negative or non-integer gold or troops, troops above the cap. */
  readonly violations: readonly string[];
  /** Undecided at the end with nobody gaining ground for 10 min: a stalemate. */
  readonly stalemate: boolean;
  /** Slowest tick and the 99th percentile, in ms: the engine's cost. */
  readonly tickMaxMs: number;
  readonly tickP99Ms: number;
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
  const game = createGame({
    terrain,
    seed: setup.seed,
    players,
    balance,
    ...(setup.rules ? { rules: setup.rules } : {}),
  });
  installNations(game, nations, setup.difficulty);
  const avoid = manifest.nations.map((n) => n.tile);
  const me: ProfilePlayer = makePlayer
    ? makePlayer(game, setup.seed, avoid)
    : new StyledPlayer(game, 1, STYLES[setup.profile], setup.seed, avoid);

  const perMinute = 60 * balance.ticksPerSecond;
  const lastTick = balance.spawnPhaseTicks + setup.minutes * perMinute;
  const ownable = terrain.ownableCount;
  const violations = new Set<string>();
  const flag = (what: string): void => {
    if (violations.size < 20) violations.add(what);
  };
  const stepMs: number[] = [];
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

  while (game.tick < lastTick) {
    const orders = game.tick === 0 || game.phase === "play" ? me.orders() : [];
    const turn: Turn = { tick: game.tick, orders: orders.map((order) => ({ player: 1, order })) };
    const t0 = performance.now();
    try {
      game.step(turn);
    } catch (error) {
      flag(`exception at tick ${String(game.tick)}: ${String(error)}`);
      break;
    }
    stepMs.push(performance.now() - t0);
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
        if (!changedThisMinute) deadMinutes++;
        if (attackedThisMinute) {
          underAttackMinutes++;
          firstFight ??= playMinutesDone;
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
    }
    if (game.decidedAt !== undefined && decidedAt === undefined) {
      decidedAt = (game.decidedAt - balance.spawnPhaseTicks) / perMinute;
      break;
    }
  }
  const sorted = [...stepMs].sort((a, b) => a - b);
  const alive = game.player(1)?.alive ?? false;
  const stalemate = decidedAt === undefined && playMinutesDone - sigSince >= 10;
  return {
    setup,
    won: game.winner === 1,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(game.winner === undefined ? {} : { winner: game.winner }),
    aliveAtEnd: alive,
    ...(eliminatedAt === undefined ? {} : { eliminatedAt }),
    finalSharePercent: (game.territory.tileCount(1) * 100) / ownable,
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
    tickP99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    hash: game.hash(),
    ms: Math.round(performance.now() - began),
  };
}
