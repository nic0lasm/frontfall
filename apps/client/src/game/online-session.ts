import type { DesyncReport, Order, Turn } from "@frontfall/engine";
import { TICK_RATE, type ReportReason } from "@frontfall/protocol";
import type { MapInfo } from "../maps.ts";
import type { GameSnapshot, GameUpdate, SoloOptions } from "./game-runner.ts";
import { BASE_PACE } from "./pace.ts";
import type { SessionCapabilities, SessionEvents } from "./session.ts";
import { TurnPacer } from "./turn-pacer.ts";
import { WorkerSession, type SessionDeps } from "./worker-session.ts";

/** How often the turns of an online game are checked for being due. */
export const PACER_MS = 10;

/** Where an online game's orders and state hashes go: the connection to the server. */
export interface ServerLink {
  order(order: Order): void;
  hash(tick: number, hash: number): void;
  /** The game as it stands, to keep for a reload (#39). */
  snapshot?(snapshot: GameSnapshot): void;
  /** The game could not start from its snapshot: every turn from the first one is needed. */
  replayFromStart?(): void;
  /** Reports another player of the game to the server's operator (R-MODE-06). */
  report?(player: number, reason: ReportReason): void;
}

/** The time and a repeating timer, handed in so that a test runs the pacer by hand. */
export interface SessionClock {
  now(): number;
  /** Calls `run` every `ms` until the returned function is called. */
  every(ms: number, run: () => void): () => void;
}

const PAGE_CLOCK: SessionClock = {
  now: () => performance.now(),
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    return () => {
      clearInterval(timer);
    };
  },
};

/**
 * A game with other people: orders go to the server, and the game advances
 * only with the turns it relays, evened out by a pacer before the worker
 * plays them. The game never pauses and runs at the host's pace.
 */
export class OnlineSession extends WorkerSession {
  readonly capabilities: SessionCapabilities;
  private readonly pacer: TurnPacer;
  private readonly clock: SessionClock;
  private readonly stopPacing: () => void;

  constructor(
    options: SoloOptions,
    map: MapInfo,
    events: SessionEvents,
    private readonly link: ServerLink,
    deps: SessionDeps & { readonly clock?: SessionClock } = {},
  ) {
    super(options, map, events, { online: true, keep: false }, deps);
    this.capabilities = {
      kind: "online",
      canPause: false,
      canOrder: true,
      canSetSpeed: false,
      recordable: true,
      relayed: true,
      canHide: true,
      canReport: link.report !== undefined,
      guided: false,
    };
    const clock = deps.clock ?? PAGE_CLOCK;
    this.clock = clock;
    // The host's pace: `speed` turns at each beat of the server (R-MODE-07).
    const pace = (options.speed ?? 1) * BASE_PACE;
    this.pacer = new TurnPacer(
      (turns) => {
        this.post({ type: "turns", turns });
        let mine = 0;
        for (const turn of turns) {
          for (const entry of turn.orders) if (entry.player === options.you) mine++;
        }
        if (mine > 0) events.onArrived?.(mine);
      },
      1000 / TICK_RATE / pace,
      pace,
    );
    // A timer rather than frames: a hidden tab draws nothing but must keep playing.
    this.stopPacing = clock.every(PACER_MS, () => {
      this.pacer.update(clock.now());
    });
  }

  protected override updated(update: GameUpdate): void {
    for (const { tick, hash } of update.hashes ?? []) this.link.hash(tick, hash);
    super.updated(update);
  }

  protected snapshotTaken(snapshot: GameSnapshot): void {
    this.link.snapshot?.(snapshot);
  }

  protected snapshotRefused(): void {
    this.link.replayFromStart?.();
  }

  protected clickOrdered(order: Order): void {
    this.link.order(order);
  }

  override sendOrder(order: Order): void {
    this.link.order(order);
  }

  /** An online game runs at the server's pace for everyone. */
  override setPaused(): void {}

  override setSpeed(): void {}

  /** Online, the worker sends its snapshots every two minutes on its own (#39). */
  requestSnapshot(): void {}

  pushTurns(turns: Turn[]): void {
    const now = this.clock.now();
    this.pacer.push(turns, now);
    this.pacer.update(now);
  }

  desync(tick: number, expected: number | null): void {
    this.post({ type: "desync", tick, expected });
  }

  desyncReport(): Promise<DesyncReport | undefined> {
    return this.askReport();
  }

  reportPlayer(player: number, reason: ReportReason): void {
    this.link.report?.(player, reason);
  }

  override dispose(): void {
    this.stopPacing();
    super.dispose();
  }
}
