import type { DesyncReport, GameRecord, Order, Turn } from "@frontfall/engine";
import type { MapManifest, ReportReason } from "@frontfall/protocol";
import { fetchManifest, type MapInfo } from "../maps.ts";
import { usage } from "../usage.ts";
import type { ClickMode, GameSnapshot, GameUpdate, SoloOptions } from "./game-runner.ts";
import type { WorkerReply, WorkerRequest } from "./messages.ts";
import type { GameSession, SessionCapabilities, SessionEvents } from "./session.ts";
import { simWorker, type SimPort } from "./sim-port.ts";

/** What a session takes from the page, handed in so that a test can stand in for it. */
export interface SessionDeps {
  /** Opens the simulation worker. */
  readonly worker?: () => SimPort;
  /** The map's manifest, checked by the page so that the worker does without the schemas. */
  readonly manifest?: (map: MapInfo) => Promise<MapManifest | undefined>;
  /** Notes in the usage report why a snapshot was refused. */
  readonly noteRefusal?: (reason: string) => void;
}

/**
 * A game simulated on this machine, in a worker so the page keeps drawing at
 * full speed. Each mode (solo-session.ts, online-session.ts,
 * replay-session.ts) says where orders go and what the worker's snapshots
 * are for; what a mode cannot do does nothing here.
 */
export abstract class WorkerSession implements GameSession {
  abstract readonly capabilities: SessionCapabilities;
  private readonly worker: SimPort;
  /** Callers waiting for a desync report, answered in order. */
  private readonly reports: ((report: DesyncReport | undefined) => void)[] = [];
  /** Callers waiting for a record of the game, answered in order. */
  private readonly records: ((record: GameRecord | undefined) => void)[] = [];
  private readonly started: Promise<void>;
  /** Number of the last `peek` asked. */
  private peeks = 0;
  private readonly noteRefusal: (reason: string) => void;

  constructor(
    options: SoloOptions,
    map: MapInfo,
    protected readonly events: SessionEvents,
    /** `online`: the worker runs no clock; `keep`: it sends snapshots now and then. */
    start: { readonly online: boolean; readonly keep: boolean },
    deps: SessionDeps = {},
  ) {
    this.noteRefusal =
      deps.noteRefusal ??
      ((reason) => {
        usage().error("snapshot", reason);
      });
    this.worker = (deps.worker ?? simWorker)();
    this.worker.onmessage = (event) => {
      this.receive(event.data);
    };
    this.worker.onerror = (event) => {
      events.onError(event.message);
    };
    // Every request waits for the start, which waits for the map's manifest.
    this.started = (deps.manifest ?? fetchManifest)(map).then(
      (manifest) => {
        this.worker.postMessage({ type: "start", options, map, manifest, ...start });
      },
      (error: unknown) => {
        events.onError(error instanceof Error ? error.message : String(error));
      },
    );
  }

  private receive(reply: WorkerReply): void {
    const { events } = this;
    if (reply.type === "started") events.onStart(reply);
    else if (reply.type === "update") this.updated(reply.update);
    else if (reply.type === "report") this.reports.shift()?.(reply.report);
    else if (reply.type === "record") this.records.shift()?.(reply.record);
    else if (reply.type === "snapshot") this.snapshotTaken(reply.snapshot);
    else if (reply.type === "snapshotRefused") {
      console.warn(`snapshot refused: ${reply.reason}`);
      this.noteRefusal(reply.reason);
      this.snapshotRefused();
    } else if (reply.type === "peek") {
      // Answers come in order: only the latest question still matters.
      if (reply.seq === this.peeks) events.onPeek(reply);
    } else if (reply.type === "click") {
      if (reply.order) this.clickOrdered(reply.order);
      events.onClick(reply.tile, reply.outcome, reply.note);
    } else events.onError(reply.message);
  }

  /** An update of the game, once per tick. */
  protected updated(update: GameUpdate): void {
    this.events.onUpdate(update);
  }

  /** A snapshot the worker took, to keep for a reload. */
  protected abstract snapshotTaken(snapshot: GameSnapshot): void;

  /** The game could not start from the snapshot of its options. */
  protected abstract snapshotRefused(): void;

  /** Online: the order a click turned into, which the page sends on. */
  protected abstract clickOrdered(order: Order): void;

  sendOrder(order: Order): void {
    this.post({ type: "order", order });
  }

  click(
    tile: number,
    ratio: number,
    mode: ClickMode = "attack",
    reach?: number,
    seen?: number,
  ): void {
    this.post({
      type: "click",
      tile,
      ratio,
      mode,
      ...(reach === undefined ? {} : { reach }),
      ...(seen === undefined ? {} : { seen }),
    });
  }

  peek(tile: number, mode: ClickMode, reach?: number): void {
    this.post({
      type: "peek",
      seq: ++this.peeks,
      tile,
      mode,
      ...(reach === undefined ? {} : { reach }),
    });
  }

  setPaused(paused: boolean): void {
    this.post({ type: "pause", paused });
  }

  setSpeed(speed: number): void {
    this.post({ type: "speed", speed });
  }

  record(): Promise<GameRecord | undefined> {
    return new Promise((resolve) => {
      this.records.push(resolve);
      this.post({ type: "record" });
    });
  }

  abstract requestSnapshot(): void;
  abstract pushTurns(turns: Turn[]): void;
  abstract desync(tick: number, expected: number | null): void;
  abstract desyncReport(): Promise<DesyncReport | undefined>;
  abstract reportPlayer(player: number, reason: ReportReason): void;

  dispose(): void {
    this.post({ type: "stop" });
    this.worker.terminate();
  }

  /** Asks the worker for a desync report, answered in order. */
  protected askReport(): Promise<DesyncReport | undefined> {
    return new Promise((resolve) => {
      this.reports.push(resolve);
      this.post({ type: "report" });
    });
  }

  protected post(request: WorkerRequest): void {
    void this.started.then(() => {
      this.worker.postMessage(request);
    });
  }
}
