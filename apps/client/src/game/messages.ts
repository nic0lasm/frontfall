import type {
  DesyncReport,
  GameRecord,
  GameRules as SpecialRules,
  Order,
  Turn,
} from "@frontfall/engine";
import type { MapManifest } from "@frontfall/protocol";
import type { MapInfo } from "./maps.ts";
import type { StartInfo } from "./session.ts";
import type {
  ClickMode,
  ClickNote,
  ClickPreview,
  ClickRefusal,
  GameSnapshot,
  GameUpdate,
  SoloOptions,
} from "./solo-game.ts";

/** What became of a click: the order it sent, or why it sent none. */
export type ClickOutcome = Order["type"] | ClickRefusal;

/** What the interface shows of the rules of a game, from the engine's balance. */
export interface GameRules {
  readonly ownableTiles: number;
  readonly ticksPerSecond: number;
  /** B-WIN-SHARE: share of the ownable land that wins, in percent. */
  readonly winSharePercent: number;
  /** B-MAX-DURATION: the leader wins when the game reaches it. */
  readonly maxDurationTicks: number;
  /** B-RETREAT-PENALTY: share of an attack's troops lost when it is called back, in percent. */
  readonly retreatPenaltyPercent: number;
  /** Lowest id of the map's nations, which take the colours of their own (`colorOf`); above every id without them. */
  readonly firstNation: number;
  /** B-GROWTH-FLOOR: how fast an empty army grows, in percent of the full rate. */
  readonly growthFloorPercent: number;
  /** B-ALLIANCE-REQUEST-TIMEOUT, in ticks. */
  readonly allianceRequestTicks: number;
  /** Team of each player by id in a team game (R-MODE-02), empty in a free-for-all. */
  readonly teams: readonly number[];
  /** What the game leaves out (R-MODE-03), as the engine's `Disable` bits. */
  readonly disabled: number;
  /** Special rules of the game (R-MODE-08). */
  readonly special: SpecialRules;
}

/** From the page to the simulation worker. */
export type WorkerRequest =
  /** `online`: no clock of its own; the game advances with the turns the page relays. */
  /** `manifest`: checked by the page (`fetchManifest`); none for a generated map. */
  | {
      type: "start";
      options: SoloOptions;
      map: MapInfo;
      manifest: MapManifest | undefined;
      online?: boolean;
    }
  /** Online: consecutive turns from the server, from the next tick on. */
  | { type: "turns"; turns: Turn[] }
  | { type: "order"; order: Order }
  /** A click on the map, turned into an order by the worker, which knows the game. */
  | { type: "click"; tile: number; ratio: number; mode: ClickMode; reach?: number }
  /** What a click would do, without doing it: answered by a `peek` with the same `seq`. */
  | { type: "peek"; seq: number; tile: number; mode: ClickMode; reach?: number }
  | { type: "pause"; paused: boolean }
  /** Online: the server flagged this client's hash after `tick`. */
  | { type: "desync"; tick: number; expected: number | null }
  /** Online: the desync report, as of now. */
  | { type: "report" }
  /** The game so far, to watch again. */
  | { type: "record" }
  /** Ticks per beat of the clock: how fast a replay runs. */
  | { type: "speed"; speed: number }
  /** The page leaves the game: the clock stops before the worker is terminated. */
  | { type: "stop" };

/** From the simulation worker to the page. */
export type WorkerReply =
  | ({ type: "started" } & StartInfo)
  | { type: "update"; update: GameUpdate }
  /** Online, `order` is what the page must send to the server; solo, the worker queued it. */
  | { type: "click"; tile: number; outcome: ClickOutcome; order?: Order; note?: ClickNote }
  | ({ type: "peek"; seq: number } & ClickPreview)
  /** None for a game on a generated map. */
  | { type: "report"; report: DesyncReport | undefined }
  /** None for a game on a generated map, or while watching a replay. */
  | { type: "record"; record: GameRecord | undefined }
  /** Online: the game as it stands, now and then, to start from after a reload (#39). */
  | { type: "snapshot"; snapshot: GameSnapshot }
  /**
   * Online: the snapshot of the options could not be loaded. The game starts
   * from its first tick instead, and waits for the turns from there.
   */
  | { type: "snapshotRefused"; reason: string }
  | { type: "error"; message: string };

/** Buffers of an update, handed over to the page instead of copied. */
export function transferables(update: GameUpdate): ArrayBuffer[] {
  const buffers = [update.changedTiles.buffer, update.changedOwners.buffer];
  if (update.owners) buffers.push(update.owners.buffer);
  return buffers as ArrayBuffer[];
}
