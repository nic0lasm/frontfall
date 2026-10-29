/**
 * The clock of a solo game: one beat every `intervalMs`, on a fixed schedule.
 * An order would wait up to a whole beat for the next one; `pull` plays that
 * beat at once instead, and the one after keeps its time, so the game runs at
 * the same pace on average and an order shows on the map without waiting.
 * The clock is never more than one beat ahead of its schedule.
 */
export class BeatClock {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the next beat is due, on performance.now()'s scale. */
  private next = 0;

  constructor(
    private readonly beat: () => void,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.stop();
    this.next = performance.now() + this.intervalMs;
    this.schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Plays the next beat now, unless it is already more than a beat away; whether it did. */
  pull(): boolean {
    if (this.timer === undefined) return false;
    const now = performance.now();
    if (this.next - now > this.intervalMs) return false;
    this.stop();
    this.run(now);
    return true;
  }

  private schedule(): void {
    this.timer = setTimeout(
      () => {
        this.run(performance.now());
      },
      Math.max(0, this.next - performance.now()),
    );
  }

  private run(now: number): void {
    // Behind by more than a beat (a hidden tab, a long pause): start afresh rather than catch up.
    this.next = Math.max(this.next, now - this.intervalMs) + this.intervalMs;
    this.schedule();
    this.beat();
  }
}
