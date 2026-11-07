import { TICK_RATE } from "@frontfall/protocol";
import type { Clock, Timer } from "./clock.ts";
import type { Directory } from "./directory.ts";
import type { Metrics } from "./metrics.ts";

/** Passes of the turn timer in one tick, each over a share of the games. */
const TURN_PASSES = 10;

export interface TurnTimer {
  /** `clock.monotonic()` at the end of the last pass, or at the start while none has run. */
  lastTurnAt(): number;
  /** Stops the timer. */
  stop(): void;
}

/**
 * Each pass closes the turns of a tenth of the games: every game still gets
 * one turn per tick, and the server answers in between. Passes keep to a
 * fixed schedule, so that the delays of timers never add up into slower games.
 */
export function startTurnTimer(clock: Clock, games: Directory, metrics: Metrics): TurnTimer {
  const passMs = 1000 / TICK_RATE / TURN_PASSES;
  let lastTurnAt = clock.monotonic();
  let pass = 0;
  let passAt = clock.monotonic();
  let ticker: Timer;
  const turnPass = (): void => {
    const started = clock.monotonic();
    games.update(clock.now(), { index: pass % TURN_PASSES, of: TURN_PASSES });
    pass++;
    lastTurnAt = clock.monotonic();
    metrics.turnDuration.observe((lastTurnAt - started) / 1000);
    // Late by more than a tick, as after a stall, the schedule starts afresh.
    passAt = Math.max(passAt + passMs, lastTurnAt - passMs * TURN_PASSES);
    ticker = clock.setTimeout(turnPass, Math.max(0, passAt - lastTurnAt));
  };
  ticker = clock.setTimeout(turnPass, passMs);
  return {
    lastTurnAt: () => lastTurnAt,
    stop: () => {
      ticker.clear();
    },
  };
}
