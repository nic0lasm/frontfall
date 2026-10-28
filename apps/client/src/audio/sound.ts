import type { GameUpdate } from "../game/game-view.ts";
import { CueWatcher, type Cue } from "./cues.ts";
import { play } from "./synth.ts";

/** What the player chose in the settings. */
export interface SoundSettings {
  /** 0 to 100. */
  volume: number;
  muted: boolean;
}

/** The least time between two sounds of one kind, so a burst of events stays a single, soft one. */
const MIN_GAP_MS = 250;
/** The master level at full volume: the effects are meant to stay discreet. */
const MASTER = 0.4;

/**
 * The sound effects of one game, made with the Web Audio API: no file is
 * fetched. Browsers keep a page silent until the player has clicked or
 * pressed a key once, so a cue that comes before is dropped, not queued.
 */
export class Sound {
  private readonly watcher = new CueWatcher();
  private readonly last = new Map<Cue, number>();
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;

  constructor(private readonly settings: () => SoundSettings) {}

  /** Reads one update of a live game and plays what it holds. */
  observe(update: GameUpdate): void {
    // A replay and a paused or finished screen are watched, not played.
    if (update.replay) return;
    for (const cue of this.watcher.observe(update)) this.cue(cue);
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    this.master = undefined;
  }

  private cue(cue: Cue): void {
    const { volume, muted } = this.settings();
    if (muted || volume <= 0) return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? -Infinity) < MIN_GAP_MS) return;
    // Until the page was used once the browser would hold the sound back and release it late.
    // Older browsers lack the flag; the context's own state then decides below.
    const activation = (navigator as { userActivation?: UserActivation }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    if (ctx.state !== "running" || !this.master) return;
    this.last.set(cue, now);
    const level = (volume / 100) ** 2 * MASTER;
    this.master.gain.setValueAtTime(level, ctx.currentTime);
    play(ctx, this.master, cue, ctx.currentTime);
  }

  private context(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    } catch {
      // No Web Audio: the game stays silent.
      this.ctx = undefined;
    }
    return this.ctx;
  }
}
