import type { Turn } from "@frontfall/engine";

/** A batch of more beats than this is a backlog (a stall, a hidden tab, a rejoin), not jitter. */
const MAX_BACKLOG = 4;
/** Recent turns whose delay sets how long turns are held back. */
const WINDOW = 30;
/**
 * The latest turns of the window that do not set the delay: a turn held up
 * once, by the network or by a busy page, plays late on its own rather than
 * holding every turn after it back for the length of the window.
 */
const LATE_IGNORED = 3;

/**
 * A jitter buffer for an online game's turns. The server runs one turn per
 * tick, but the network bunches them: two arrive together, then none for a
 * while. The pacer plays turn n at a fixed offset from n ticks of the clock,
 * the largest delay among recent turns but for the LATE_IGNORED latest, so
 * turns come out one per tick whatever the jitter, at the price of that
 * delay. A backlog is played at once, and the delay is measured afresh from
 * its last turn.
 */
export class TurnPacer {
  private queue: Turn[] = [];
  /** Arrival time minus scheduled time, for the last turns. */
  private delays: number[] = [];
  /** How long after its tick of the clock a turn plays. */
  private offset = 0;

  constructor(
    private readonly play: (turns: Turn[]) => void,
    private readonly intervalMs: number,
    /** Turns the server sends at each beat (R-MODE-07). */
    private readonly perBeat = 1,
  ) {}

  /** Turns from the server, in order, received at `now`. */
  push(turns: readonly Turn[], now: number): void {
    if (turns.length === 0) return;
    if (turns.length > MAX_BACKLOG * this.perBeat) {
      this.play([...this.queue.splice(0), ...turns]);
      const last = turns[turns.length - 1] as Turn;
      this.delays = [now - last.tick * this.intervalMs];
      this.offset = this.delays[0] as number;
      return;
    }
    for (const turn of turns) {
      this.queue.push(turn);
      this.delays.push(now - turn.tick * this.intervalMs);
    }
    if (this.delays.length > WINDOW) this.delays.splice(0, this.delays.length - WINDOW);
    const sorted = [...this.delays].sort((a, b) => b - a);
    this.offset = sorted[Math.min(LATE_IGNORED, sorted.length - 1)] as number;
  }

  /** Call often, once per frame: plays the turns due at `now`. */
  update(now: number): void {
    if (this.queue.length === 0) return;
    const offset = this.offset;
    let due = 0;
    while (
      due < this.queue.length &&
      (this.queue[due] as Turn).tick * this.intervalMs + offset <= now
    ) {
      due++;
    }
    if (due > 0) this.play(this.queue.splice(0, due));
  }

  get pending(): number {
    return this.queue.length;
  }
}
