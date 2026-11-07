import type { DesyncReport, GameRecord } from "@frontfall/engine";
import type { MapInfo } from "../maps.ts";
import type { SoloOptions } from "./game-runner.ts";
import type { SessionCapabilities, SessionEvents } from "./session.ts";
import { WorkerSession, type SessionDeps } from "./worker-session.ts";

const REPLAY: SessionCapabilities = {
  kind: "replay",
  canPause: true,
  canOrder: false,
  canSetSpeed: true,
  recordable: false,
  relayed: false,
  canHide: false,
  canReport: false,
  guided: false,
};

/**
 * A recorded game watched again (`options.record`): the worker plays the
 * turns of the record at the pace of the bar, and nobody gives orders.
 */
export class ReplaySession extends WorkerSession {
  readonly capabilities = REPLAY;

  constructor(options: SoloOptions, map: MapInfo, events: SessionEvents, deps?: SessionDeps) {
    super(options, map, events, { online: false, keep: false }, deps);
  }

  override sendOrder(): void {}

  override click(): void {}

  /** A replay is a record already. */
  override record(): Promise<GameRecord | undefined> {
    return Promise.resolve(undefined);
  }

  // Nothing of a replay is kept, relayed or reported.
  protected snapshotTaken(): void {}

  protected snapshotRefused(): void {}

  protected clickOrdered(): void {}

  requestSnapshot(): void {}

  pushTurns(): void {}

  desync(): void {}

  desyncReport(): Promise<DesyncReport | undefined> {
    return Promise.resolve(undefined);
  }

  reportPlayer(): void {}
}
