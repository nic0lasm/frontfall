import type { Clock, Timer } from "../../src/clock.ts";

interface Pending {
  at: number;
  readonly run: () => void;
  /** Set for an interval: its period. */
  readonly every: number | undefined;
}

/**
 * A clock that only moves when a test says so. Timers run in `advance`, in
 * the order they are due, each seeing the time it was due at.
 */
export class FakeClock implements Clock {
  private time: number;
  private elapsed = 0;
  /** In the order they were set, which breaks ties between timers due at once. */
  private pending: Pending[] = [];

  /** @param start the wall time to begin at; 1 January 2026 by default. */
  constructor(start = Date.UTC(2026, 0, 1)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  monotonic(): number {
    return this.elapsed;
  }

  setTimeout(run: () => void, ms: number): Timer {
    return this.add(run, ms, undefined);
  }

  setInterval(run: () => void, ms: number): Timer {
    return this.add(run, ms, Math.max(1, ms));
  }

  /** Timers waiting to run. */
  get timers(): number {
    return this.pending.length;
  }

  /** Moves the time on by `ms`, running every timer that falls due on the way. */
  advance(ms: number): void {
    const end = this.elapsed + ms;
    for (;;) {
      const next = this.pending.reduce<Pending | undefined>(
        (soonest, timer) => (soonest === undefined || timer.at < soonest.at ? timer : soonest),
        undefined,
      );
      if (next === undefined || next.at > end) break;
      this.moveTo(next.at);
      if (next.every === undefined) this.pending = this.pending.filter((timer) => timer !== next);
      else next.at += next.every;
      next.run();
    }
    this.moveTo(end);
  }

  private moveTo(elapsed: number): void {
    this.time += elapsed - this.elapsed;
    this.elapsed = elapsed;
  }

  private add(run: () => void, ms: number, every: number | undefined): Timer {
    const timer: Pending = {
      at: this.elapsed + Math.max(0, ms),
      run,
      every,
    };
    this.pending.push(timer);
    const handle: Timer = {
      clear: () => {
        this.pending = this.pending.filter((other) => other !== timer);
      },
      unref: () => handle,
    };
    return handle;
  }
}
