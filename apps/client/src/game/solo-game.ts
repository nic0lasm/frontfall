import {
  DESYNC_REPORT_VERSION,
  GAME_RECORD_VERSION,
  Terrain,
  WorldGrid,
  loadSnapshot,
  ruleBits,
  saveSnapshot,
  type DesyncReport,
  type Game,
  type GameRecord,
  type Order,
  type PlayerSetup,
  type Turn,
} from "@frontfall/engine";
import { HASH_INTERVAL, PROTOCOL_VERSION } from "@frontfall/protocol";
import { BUILD } from "../net/build.ts";
import { RELEASE } from "../release.ts";
import type {
  ClickMode,
  ClickPreview,
  ClickResult,
  Difficulty,
  GameSnapshot,
  GameUpdate,
  SoloOptions,
} from "./game-view.ts";
import { orderForClick, previewForClick } from "./click-orders.ts";
import { gameUpdate } from "./game-update.ts";
import { HUMAN_ID, createSimulation, newSetup } from "./simulation.ts";

export type * from "./game-view.ts";
export { HUMAN_ID, MAX_BOTS } from "./simulation.ts";
import type { MapData } from "./maps.ts";

/**
 * One game as this client runs it: the engine with every rule installed and
 * the bots. Online, it plays the turns the server relays (`playTurns`); solo,
 * `step` relays the player's orders into the same kind of turn, so both go
 * down one path. Runs in a worker in the browser and directly in tests.
 */
export class SoloGame {
  readonly game: Game;
  readonly ownableTiles: number;
  /** The player at this screen. */
  readonly you: number;
  /** Online games report state hashes; a solo game has no one to compare with. */
  private readonly online: boolean;
  private readonly depth: Uint16Array;
  private readonly players: PlayerSetup[];
  private readonly botIds: number[];
  private readonly nationIds: number[];
  private readonly difficulty: Difficulty;
  /** Every turn with orders, for a record of the game and, online, a desync report. */
  private readonly history: Turn[] = [];
  /** Turns of the game being watched again, by tick. */
  private readonly recorded: ReadonlyMap<number, Turn["orders"]> | undefined;
  private readonly hashes: { tick: number; local: number }[] = [];
  /** Why the snapshot of the options could not be loaded; the game then starts from its first tick. */
  readonly snapshotRefused: string | undefined;
  /** Hashes the server says most players had, where this client's differed. */
  private readonly expected = new Map<number, number | null>();

  constructor(
    readonly options: SoloOptions,
    private readonly map: MapData,
  ) {
    const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
    const terrain = new Terrain(grid, map.kinds);
    const { record } = options;
    const { players, botIds, nationIds, balance } = record
      ? {
          players: record.players,
          botIds: record.bots.ids,
          nationIds: record.nations ?? [],
          balance: record.balance,
        }
      : newSetup(options, map.nations);
    this.you = options.record?.you ?? options.you ?? HUMAN_ID;
    const seed = options.record?.seed ?? options.seed;
    const teams = options.record ? (options.record.teams ?? 0) : (options.teams ?? 0);
    const disabled = options.record ? (options.record.disabled ?? 0) : (options.disabled ?? 0);
    const rules = (options.record ? options.record.rules : options.rules) ?? {};
    const difficulty = options.record?.bots.difficulty ?? options.difficulty;
    const create = (): Game =>
      createSimulation(
        { terrain, seed, players, balance, teams, disabled, rules },
        botIds,
        nationIds,
        difficulty,
      );
    const { snapshot } = options;
    const loaded =
      snapshot && !options.record ? loadSnapshot(snapshot.bytes, BUILD, create) : undefined;
    if (snapshot && loaded?.ok) {
      this.game = loaded.game;
      this.history.push(...snapshot.history);
    } else {
      this.game = create();
    }
    this.snapshotRefused = loaded && !loaded.ok ? loaded.reason : undefined;
    this.players = players;
    this.botIds = botIds;
    this.nationIds = nationIds;
    this.difficulty = difficulty;
    this.online = options.players !== undefined && !options.record;
    if (options.record) {
      this.recorded = new Map(options.record.turns.map((turn) => [turn.tick, turn.orders]));
    }
    this.depth = new Uint16Array(grid.size);
    let ownable = 0;
    for (let tile = 0; tile < grid.size; tile++) if (terrain.isOwnable(tile)) ownable++;
    this.ownableTiles = ownable;
  }

  /** The game as it stands, to start from after a reload (#39). */
  snapshot(): GameSnapshot {
    return {
      tick: this.game.tick,
      bytes: saveSnapshot(this.game, BUILD),
      history: [...this.history],
    };
  }

  /** Lowest id of the nations, or one past the last player when there are none. */
  get firstNation(): number {
    return this.nationIds[0] ?? Math.max(...this.players.map((player) => player.id)) + 1;
  }

  get winner(): number | undefined {
    return this.game.winner;
  }

  /** Team of each player by id, 0 for none; empty in a free-for-all (R-MODE-02). */
  teamsById(): number[] {
    if (this.game.teams === 0) return [];
    const teams: number[] = [];
    for (const player of this.game.players()) teams[player.id] = player.team;
    return Array.from(teams, (team: number | undefined) => team ?? 0);
  }

  /** What a click on `tile` means for the player at this screen now (click-orders.ts). */
  orderForClick(
    tile: number,
    ratio: number,
    mode: ClickMode = "attack",
    reach?: number,
  ): ClickResult {
    return orderForClick(this.game, this.you, tile, ratio, mode, reach);
  }

  /** What a click in a build mode would do, without doing it. */
  previewClick(tile: number, mode: ClickMode, reach?: number): ClickPreview {
    return previewForClick(this.game, this.you, tile, mode, reach);
  }

  /**
   * Solo: runs one tick with the player's orders and returns what changed.
   * Once the game is decided the bots play on for spectators (R-WIN-03), and
   * the player's orders are dropped.
   */
  step(orders: readonly Order[]): GameUpdate {
    // The local relay: the turn the server would send, with this player's orders only.
    const turn: Turn = {
      tick: this.game.tick,
      orders:
        this.game.winner === undefined ? orders.map((order) => ({ player: this.you, order })) : [],
    };
    return this.playTurns([turn]);
  }

  /**
   * Online: runs turns relayed by the server, every player's orders in
   * them, and returns what changed over all of them. Hashes of the state
   * after every HASH_INTERVAL-th tick come with the update, for the server
   * to compare between players.
   */
  playTurns(turns: readonly Turn[]): GameUpdate {
    const hashes: { tick: number; hash: number }[] = [];
    for (const turn of turns) {
      this.game.step(turn);
      if (turn.orders.length > 0) this.history.push(turn);
      if (!this.online) continue;
      if (turn.tick % HASH_INTERVAL === 0) {
        const hash = this.game.hash();
        hashes.push({ tick: turn.tick, hash });
        this.hashes.push({ tick: turn.tick, local: hash });
      }
    }
    const update = gameUpdate(this.game, this.you, this.depth);
    if (hashes.length > 0) update.hashes = hashes;
    return update;
  }

  /**
   * Watching a recorded game: runs up to `ticks` more of it, with its own
   * turns, and stops at its last tick, where the hash it reaches should be
   * the one recorded.
   */
  replay(ticks: number): GameUpdate {
    const record = this.options.record;
    if (!record || !this.recorded) throw new Error("not a replay");
    const end = Math.min(record.ticks, this.game.tick + Math.max(0, Math.floor(ticks)));
    while (this.game.tick < end) {
      this.game.step({ tick: this.game.tick, orders: this.recorded.get(this.game.tick) ?? [] });
    }
    const update = gameUpdate(this.game, this.you, this.depth);
    update.replay = { ticks: record.ticks, expected: record.hash };
    if (this.game.tick >= record.ticks) update.replay.hash = this.game.hash();
    return update;
  }

  /**
   * The game so far, to watch again on this build (#50). Published maps
   * only, like a desync report; none while watching a replay.
   */
  record(): GameRecord | undefined {
    const { source } = this.map;
    if (!source || this.options.record) return undefined;
    return {
      version: GAME_RECORD_VERSION,
      build: { release: RELEASE, build: BUILD, protocol: PROTOCOL_VERSION },
      map: { id: this.map.id, ...source },
      seed: this.options.seed,
      balance: this.game.balance,
      players: this.players,
      bots: { ids: this.botIds, difficulty: this.difficulty },
      ...(this.nationIds.length > 0 ? { nations: this.nationIds } : {}),
      ...(this.game.teams > 0 ? { teams: this.game.teams } : {}),
      ...(this.game.disabled > 0 ? { disabled: this.game.disabled } : {}),
      ...(ruleBits(this.game.rules) !== 0 ? { rules: { ...this.game.rules } } : {}),
      you: this.you,
      ticks: this.game.tick,
      turns: this.history,
      hash: this.game.hash(),
    };
  }

  /** The server found this client's hash after `tick` differs from most players'. */
  desync(tick: number, expected: number | null): void {
    this.expected.set(tick, expected);
  }

  /**
   * Everything needed to replay this online game elsewhere and find where it
   * went apart (docs/engine.md, "Desync reports"). Published maps only: a
   * generated map has no terrain file to pin.
   */
  report(): DesyncReport | undefined {
    const { source } = this.map;
    if (!this.online || !source) return undefined;
    const first = Math.min(...this.expected.keys());
    return {
      version: DESYNC_REPORT_VERSION,
      build: { release: RELEASE, protocol: PROTOCOL_VERSION },
      map: { id: this.map.id, ...source },
      seed: this.options.seed,
      balance: this.game.balance,
      players: this.players,
      bots: { ids: this.botIds, difficulty: this.difficulty },
      ...(this.nationIds.length > 0 ? { nations: this.nationIds } : {}),
      ...(this.game.teams > 0 ? { teams: this.game.teams } : {}),
      ...(this.game.disabled > 0 ? { disabled: this.game.disabled } : {}),
      ...(ruleBits(this.game.rules) !== 0 ? { rules: { ...this.game.rules } } : {}),
      you: this.you,
      ticks: this.game.tick,
      turns: this.history,
      // Before the first desync the server had nothing to say: the hashes
      // matched. After it, a tick it did not flag is unknown.
      hashes: this.hashes.map(({ tick, local }) => ({
        tick,
        local,
        expected: this.expected.has(tick)
          ? (this.expected.get(tick) ?? null)
          : tick < first
            ? local
            : null,
      })),
    };
  }
}
