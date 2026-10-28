import { readFileSync } from "node:fs";
import {
  createGame,
  DEFAULT_BALANCE,
  installBots,
  installNations,
  isReady,
  loadMap,
  NEUTRAL,
  StructureKind,
  type Balance,
  type BotDifficulty,
  type MapDescription,
  type Order,
  type PlayerSetup,
  type Terrain,
  type Turn,
} from "@frontfall/engine";
import { AveragePlayer } from "./average.ts";
import { CasualPlayer } from "./casual.ts";

/** One headless game of the balance runs: who plays, where, for how long. */
export interface BalanceSetup {
  readonly map: string;
  readonly seed: number;
  /** Groups of bots, each at its own difficulty, in player-id order after the scripted player. */
  readonly bots: readonly { readonly difficulty: BotDifficulty; readonly count: number }[];
  /** Whether the map's nations play, at this difficulty. */
  readonly nations?: BotDifficulty;
  readonly teams?: number;
  /** Whether player 1 is the scripted casual player, starting near the middle of the map. */
  readonly casual?: boolean;
  /** Whether player 1 is the scripted average player instead, starting away from the nations. */
  readonly average?: boolean;
  /** Minutes of play after the spawn phase before the run stops undecided. */
  readonly minutes: number;
  /** Balance values to try instead of the defaults. */
  readonly balance?: Partial<Balance>;
}

export type PlayerKind = "casual" | "average" | "bot" | "nation";

export interface PlayerReport {
  readonly id: number;
  readonly name: string;
  readonly kind: PlayerKind;
  readonly difficulty?: BotDifficulty;
  readonly team: number;
  /** Land mass of the start tile, and whether a coast lies within the start radius. */
  readonly landmass: number;
  readonly coastal: boolean;
  /** Minutes of play when eliminated; absent if alive at the end. */
  readonly eliminatedAt?: number;
  readonly tiles: number;
  readonly peakSharePercent: number;
  /** Gold earned from idle troops and from trade, over the game. */
  readonly troopGold: number;
  readonly tradeGold: number;
  readonly missiles: number;
  /** Structures owned at the end, by kind name. */
  readonly structures: Readonly<Record<string, number>>;
}

/** The state of the game at the end of a minute of play. */
export interface MinuteReport {
  readonly minute: number;
  readonly alive: number;
  /** Largest share of the land held by one player, in %, and that player. */
  readonly leaderSharePercent: number;
  readonly leader: number;
  /** Gold per second from troops: the leader's, and the median of living players. */
  readonly leaderTroopGold: number;
  readonly medianTroopGold: number;
  /** Gold per second from trade over the minute: the leader's, and the median of living players with a port. */
  readonly leaderTradeGold: number;
  readonly medianTradeGold: number;
  /** Missiles launched during the minute, and how many of them at the leader's land. */
  readonly missiles: number;
  readonly missilesAtLeader: number;
}

export interface GameReport {
  readonly setup: BalanceSetup;
  /** Minutes of play to the decision, or undefined when the run stopped first. */
  readonly decidedAt?: number;
  readonly winner?: number;
  readonly players: readonly PlayerReport[];
  readonly minutes: readonly MinuteReport[];
  /** Most missiles launched in any 10 seconds of play. */
  readonly missileBurst: number;
  /** Share of the land the leading player holds at the end, in %. */
  readonly leaderSharePercent: number;
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

const STRUCTURE_NAMES = Object.fromEntries(
  Object.entries(StructureKind).map(([name, kind]) => [kind, name]),
) as Record<number, string>;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

/**
 * Plays one game with nobody at the controls but bots, nations and, if asked,
 * the scripted casual player, and reports what balance.md is tuned on.
 * Deterministic: the same setup gives the same report, the time aside.
 */
export function playBalanceGame(setup: BalanceSetup): GameReport {
  const began = performance.now();
  const { terrain, manifest } = publishedMap(setup.map);
  const { topology } = terrain;
  const balance: Balance = { ...DEFAULT_BALANCE, ...setup.balance };

  const players: PlayerSetup[] = [];
  const kinds = new Map<number, { kind: PlayerKind; difficulty?: BotDifficulty }>();
  if (setup.average) {
    players.push({ id: 1, name: "Average" });
    kinds.set(1, { kind: "average" });
  } else if (setup.casual) {
    players.push({ id: 1, name: "Casual" });
    kinds.set(1, { kind: "casual" });
  }
  const groups: { ids: number[]; difficulty: BotDifficulty }[] = [];
  for (const { difficulty, count } of setup.bots) {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = players.length + 1;
      players.push({ id, name: `Bot ${String(id)}` });
      kinds.set(id, { kind: "bot", difficulty });
      ids.push(id);
    }
    groups.push({ ids, difficulty });
  }
  const nations: number[] = [];
  if (setup.nations) {
    for (const { name, tile } of manifest.nations) {
      const id = players.length + 1;
      players.push({ id, name, start: tile });
      kinds.set(id, { kind: "nation", difficulty: setup.nations });
      nations.push(id);
    }
  }

  const game = createGame({
    terrain,
    seed: setup.seed,
    players,
    balance,
    ...(setup.teams ? { teams: setup.teams } : {}),
  });
  for (const { ids, difficulty } of groups) installBots(game, ids, difficulty);
  if (setup.nations) installNations(game, nations, setup.nations);
  const casual = setup.average
    ? new AveragePlayer(
        game,
        1,
        manifest.nations.map((n) => n.tile),
        setup.seed,
      )
    : setup.casual
      ? new CasualPlayer(
          game,
          1,
          topology.index(Math.floor(topology.width / 2), Math.floor(topology.height / 3)),
        )
      : undefined;

  const ownable = terrain.ownableCount;
  const perMinute = 60 * balance.ticksPerSecond;
  const lastTick = balance.spawnPhaseTicks + setup.minutes * perMinute;
  // Gold from troops is counted in the units the economy uses, to stay exact.
  const goldDivisor = 1000 * balance.ticksPerSecond;
  const troopGold = new Map<number, number>();
  const tradeGold = new Map<number, number>();
  const missilesBy = new Map<number, number>();
  const peak = new Map<number, number>();
  const eliminatedAt = new Map<number, number>();
  const minutes: MinuteReport[] = [];
  const launches: number[] = [];
  let tradeAtMinuteStart = new Map<number, number>();
  let missilesThisMinute = 0;
  let missilesAtLeader = 0;
  let seenMissile = 0;
  let decidedAt: number | undefined;

  const playMinutes = (tick: number): number => (tick - balance.spawnPhaseTicks) / perMinute;
  const add = (map: Map<number, number>, id: number, value: number): void => {
    map.set(id, (map.get(id) ?? 0) + value);
  };
  const leaderNow = (): { id: number; tiles: number } => {
    let best = { id: NEUTRAL, tiles: -1 };
    for (const p of game.players()) {
      if (!p.alive) continue;
      const tiles = game.territory.tileCount(p.id);
      if (tiles > best.tiles) best = { id: p.id, tiles };
    }
    return best;
  };

  while (game.tick < lastTick) {
    // Trade ships that reach their port this tick, with what they will pay each side.
    const arriving: { from: number; to: number; gain: number }[] = [];
    for (const ship of game.tradeShips) {
      if (ship.step + balance.boatSpeed < ship.path.length) continue;
      const port = game.structures.find(
        (s) => s.tile === ship.to && s.kind === StructureKind.Port && isReady(game, s),
      );
      if (!port || port.player === ship.player) continue;
      arriving.push({
        from: ship.player,
        to: port.player,
        gain: balance.tradeBase + balance.tradePerTile * ship.path.length,
      });
    }
    const orders: Order[] = casual ? casual.orders() : [];
    const turn: Turn = { tick: game.tick, orders: orders.map((order) => ({ player: 1, order })) };
    game.step(turn);

    for (const { from, to, gain } of arriving) {
      if (game.player(from)?.alive && game.player(to)?.alive) {
        add(tradeGold, from, gain);
        add(tradeGold, to, gain);
      }
    }
    if (game.phase !== "play") continue;
    const leader = leaderNow();
    for (const missile of game.missiles) {
      if (missile.id <= seenMissile) continue;
      seenMissile = missile.id;
      add(missilesBy, missile.player, 1);
      launches.push(game.tick);
      missilesThisMinute++;
      if (game.territory.ownerOf(missile.to) === leader.id) missilesAtLeader++;
    }
    for (const p of game.players()) {
      if (!p.alive) {
        if (!eliminatedAt.has(p.id)) eliminatedAt.set(p.id, playMinutes(game.tick));
        continue;
      }
      add(troopGold, p.id, p.troops * balance.goldPerThousandTroops);
      const share = (game.territory.tileCount(p.id) * 100) / ownable;
      if (share > (peak.get(p.id) ?? 0)) peak.set(p.id, share);
    }
    const elapsed = game.tick - balance.spawnPhaseTicks;
    if (elapsed > 0 && elapsed % perMinute === 0) {
      const alive = game.players().filter((p) => p.alive);
      const goldPerSecond = (troops: number): number =>
        (troops * balance.goldPerThousandTroops * balance.ticksPerSecond) / goldDivisor;
      const tradePerSecond = (id: number): number =>
        ((tradeGold.get(id) ?? 0) - (tradeAtMinuteStart.get(id) ?? 0)) / 60;
      const withPort = alive.filter((p) =>
        game.structures.some((s) => s.player === p.id && s.kind === StructureKind.Port),
      );
      const top = game.player(leader.id);
      minutes.push({
        minute: elapsed / perMinute,
        alive: alive.length,
        leaderSharePercent: (leader.tiles * 100) / ownable,
        leader: leader.id,
        leaderTroopGold: goldPerSecond(top?.troops ?? 0),
        medianTroopGold: median(alive.map((p) => goldPerSecond(p.troops))),
        leaderTradeGold: tradePerSecond(leader.id),
        medianTradeGold: median(withPort.map((p) => tradePerSecond(p.id))),
        missiles: missilesThisMinute,
        missilesAtLeader,
      });
      tradeAtMinuteStart = new Map(tradeGold);
      missilesThisMinute = 0;
      missilesAtLeader = 0;
    }
    if (game.decidedAt !== undefined && decidedAt === undefined) {
      decidedAt = playMinutes(game.decidedAt);
      break;
    }
  }

  // Most launches within any window of 10 seconds.
  const window = 10 * balance.ticksPerSecond;
  let missileBurst = 0;
  for (let i = 0, j = 0; i < launches.length; i++) {
    while ((launches[i] as number) - (launches[j] as number) >= window) j++;
    missileBurst = Math.max(missileBurst, i - j + 1);
  }

  const radius = Math.max(
    balance.spawnRadius,
    Math.floor((balance.spawnRadius * Math.sqrt(topology.size)) / 724),
  );
  const reports: PlayerReport[] = game.players().map((p) => {
    const start = p.start ?? -1;
    const structures: Record<string, number> = {};
    for (const s of game.structures) {
      if (s.player !== p.id) continue;
      const name = STRUCTURE_NAMES[s.kind] ?? String(s.kind);
      structures[name] = (structures[name] ?? 0) + 1;
    }
    const kind = kinds.get(p.id) ?? { kind: "bot" as const };
    const gone = eliminatedAt.get(p.id);
    return {
      id: p.id,
      name: p.name,
      kind: kind.kind,
      ...(kind.difficulty ? { difficulty: kind.difficulty } : {}),
      team: p.team,
      landmass: start < 0 ? -1 : terrain.landmassOf(start),
      coastal:
        start >= 0 && [...topology.tilesWithin(start, radius)].some((t) => terrain.isCoast(t)),
      ...(gone === undefined ? {} : { eliminatedAt: gone }),
      tiles: game.territory.tileCount(p.id),
      peakSharePercent: peak.get(p.id) ?? 0,
      troopGold: Math.floor((troopGold.get(p.id) ?? 0) / goldDivisor),
      tradeGold: tradeGold.get(p.id) ?? 0,
      missiles: missilesBy.get(p.id) ?? 0,
      structures,
    };
  });

  return {
    setup,
    ...(decidedAt === undefined || game.winner === undefined
      ? {}
      : { decidedAt, winner: game.winner }),
    players: reports,
    minutes,
    missileBurst,
    leaderSharePercent: (leaderNow().tiles * 100) / ownable,
    hash: game.hash(),
    ms: Math.round(performance.now() - began),
  };
}
