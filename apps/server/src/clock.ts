/** A timer set on a `Clock`. */
export interface Timer {
  /** Stops the timer; clearing it twice, or after it ran, does nothing. */
  clear(): void;
  /** Lets the process exit while the timer waits, as Node's `unref`. Returns the timer. */
  unref(): Timer;
}

/**
 * The server's only way to read the time or wait. Tests hand the server a
 * clock they move themselves; everything else gets `systemClock`.
 */
export interface Clock {
  /** Milliseconds since 1970, as `Date.now()`: for what is kept, shown or compared with a date. */
  now(): number;
  /** Milliseconds since an arbitrary start, never going back, as `performance.now()`: for durations. */
  monotonic(): number;
  /** Runs `run` once after `ms`. */
  setTimeout(run: () => void, ms: number): Timer;
  /** Runs `run` every `ms` until cleared. */
  setInterval(run: () => void, ms: number): Timer;
}

/** A Node or Bun timer handle, behind the `Timer` interface. */
function handle(
  timer: ReturnType<typeof setTimeout>,
  clear: (timer: ReturnType<typeof setTimeout>) => void,
): Timer {
  const wrapped: Timer = {
    clear: () => {
      clear(timer);
    },
    unref: () => {
      timer.unref();
      return wrapped;
    },
  };
  return wrapped;
}

/** The time of the machine, and its timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  setTimeout: (run, ms) => handle(setTimeout(run, ms), clearTimeout),
  setInterval: (run, ms) => handle(setInterval(run, ms), clearInterval),
};
