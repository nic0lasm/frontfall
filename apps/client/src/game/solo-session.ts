import type { DesyncReport } from "@frontfall/engine";
import type { MapInfo } from "../maps.ts";
import type { GameSnapshot, SoloOptions } from "./game-runner.ts";
import type { SessionCapabilities, SessionEvents } from "./session.ts";
import { WorkerSession, type SessionDeps } from "./worker-session.ts";

/** Solo: the game kept for a reload could not be taken back, as after an update of the game. */
export const SOLO_SNAPSHOT_REFUSED = "the solo game kept could not be taken back";

const SOLO: SessionCapabilities = {
  kind: "solo",
  canPause: true,
  canOrder: true,
  canSetSpeed: true,
  recordable: true,
  relayed: false,
  canHide: false,
  canReport: false,
  guided: true,
};

/**
 * A game against bots on this machine: the worker runs its own clock and
 * takes the orders, and its snapshots go to `keep` so a reload takes the
 * game back.
 */
export class SoloSession extends WorkerSession {
  readonly capabilities = SOLO;

  constructor(
    options: SoloOptions,
    map: MapInfo,
    events: SessionEvents,
    /** Where the snapshots of the game go, to keep it for a reload; none when it is not kept. */
    private readonly keep?: (snapshot: GameSnapshot) => void,
    deps?: SessionDeps,
  ) {
    super(options, map, events, { online: false, keep: keep !== undefined }, deps);
  }

  protected snapshotTaken(snapshot: GameSnapshot): void {
    this.keep?.(snapshot);
  }

  protected snapshotRefused(): void {
    this.events.onError(SOLO_SNAPSHOT_REFUSED);
  }

  protected clickOrdered(): void {}

  /** A snapshot now, sent to `keep`, when the game is kept. */
  requestSnapshot(): void {
    if (this.keep) this.post({ type: "snapshot" });
  }

  // A solo game has no server: no turns come in, and nobody else to compare or report.
  pushTurns(): void {}

  desync(): void {}

  desyncReport(): Promise<DesyncReport | undefined> {
    return Promise.resolve(undefined);
  }

  reportPlayer(): void {}
}
