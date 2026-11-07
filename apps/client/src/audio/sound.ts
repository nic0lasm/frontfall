import type { GameUpdate } from "../game/game-view.ts";
import { CueWatcher, type Cue, type CueEvent } from "./cues.ts";
import { createMix, type Mix, type Place } from "./mix.ts";
import { Music } from "./music.ts";
import { PALETTE } from "./palettes.ts";
import { placeFor, placeHere } from "./place.ts";
import { soundSettings } from "./settings.ts";
import { CuePlayer } from "./synth.ts";
import { seeded } from "./voices.ts";

/** The least time between two sounds of one kind, so a burst of events stays a single, soft one. */
const MIN_GAP_MS = 220;
/** Some cues come rarer still: an alarm that kept ringing would be a nuisance. */
const GAPS_MS: Partial<Record<Cue, number>> = {
  alert: 7000,
  impact: 90,
  attack: 120,
};
/** The master levels at full volume: the effects stay discreet and the music sits under them. */
const EFFECTS = 0.55;
const MUSIC = 0.3;
/** The music is scheduled this far ahead of the clock, in seconds, and the schedule is fed this often. */
const LOOKAHEAD = 1.6;
const FEED_MS = 400;

/** What the sound needs to know of the view, to place an effect on the map. */
export interface SoundCamera {
  readonly scale: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  tileToScreen(tile: number): { x: number; y: number };
}

/**
 * The sound of one game, made with the Web Audio API: no file is fetched.
 * Effects have variants and a place on the map, heard from where the view is;
 * a light generative score follows how the game goes. Browsers keep a page
 * silent until the player has clicked or pressed a key once, so a sound that
 * comes before is dropped, not queued.
 */
export class Sound {
  private readonly watcher = new CueWatcher();
  private readonly last = new Map<Cue, number>();
  private ctx: AudioContext | undefined;
  private mix: Mix | undefined;
  private player: CuePlayer | undefined;
  private music: Music | undefined;
  private feed: ReturnType<typeof setInterval> | undefined;
  private musicOn = false;
  private over = false;
  private moodAt = 0;
  private alarmUntil = 0;
  private disposed = false;
  /** The levels last sent to the mix, so that an unchanged setting adds no automation. */
  private applied = "";

  /**
   * `camera` tells where the view is, to place sounds that happen on the map.
   * `felt` is told every cue, muted or not, to vibrate where the device can.
   */
  constructor(
    private readonly camera: () => SoundCamera | undefined = () => undefined,
    private readonly felt: (cue: Cue) => void = () => undefined,
  ) {
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Reads one update of a live game and plays what it holds. */
  observe(update: GameUpdate): void {
    // A replay and a paused or finished screen are watched, not played.
    if (update.replay || this.disposed) return;
    try {
      this.listen(update);
    } catch {
      // A sound that fails must never break the screen's update.
    }
  }

  private listen(update: GameUpdate): void {
    const events = this.watcher.observe(update);
    // Felt even when the sound is muted.
    for (const event of events) this.felt(event.cue);
    // The end of the game counts even if the sound is not ready to play it.
    if (events.some((event) => event.cue === "victory" || event.cue === "defeat")) {
      this.over = true;
    }
    const { volume, music, muted } = soundSettings();
    const hasSound = !muted && (volume > 0 || music > 0);
    if (!hasSound && !this.ctx) return;
    const ctx = this.ready();
    if (!ctx) return;
    const now = performance.now();
    if (events.some((event) => event.cue === "alert")) this.alarmUntil = now + 10000;
    this.levels(volume, music, muted);
    if (!muted && volume > 0) {
      for (const event of events) this.cue(event, ctx, now);
    }
    this.score(update, ctx, now, !muted && music > 0);
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.feed !== undefined) clearInterval(this.feed);
    this.feed = undefined;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    this.mix = undefined;
    this.player = undefined;
    this.music = undefined;
  }

  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    // A page nobody sees makes no noise, and the score does not run on ahead.
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  };

  private levels(volume: number, music: number, muted: boolean): void {
    const { ctx, mix } = this;
    if (!ctx || !mix) return;
    const effects = muted ? 0 : (volume / 100) ** 2 * EFFECTS;
    const score = muted || this.over ? 0 : (music / 100) ** 2 * MUSIC;
    const key = `${String(effects)}|${String(score)}|${String(this.over)}`;
    if (key === this.applied) return;
    this.applied = key;
    mix.setLevels(effects, score, ctx.currentTime, this.over ? 1.6 : 0.4);
  }

  /** The context, once the browser lets it run; none before the page was used or without Web Audio. */
  private ready(): AudioContext | undefined {
    // Until the page was used once the browser would hold the sound back and release it late.
    // Older browsers lack the flag; the context's own state then decides below.
    const activation = (navigator as { userActivation?: UserActivation }).userActivation;
    if (activation && !activation.hasBeenActive) return undefined;
    const ctx = this.context();
    if (!ctx) return undefined;
    if (ctx.state === "suspended" && !document.hidden) void ctx.resume().catch(() => undefined);
    return ctx.state === "running" ? ctx : undefined;
  }

  private context(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    if (this.disposed) return undefined;
    try {
      const ctx = new AudioContext();
      const rnd = seeded(Math.floor(Math.random() * 2 ** 32));
      this.mix = createMix(ctx, PALETTE.room);
      this.mix.setLevels(0, 0, ctx.currentTime);
      this.player = new CuePlayer(ctx, this.mix, PALETTE, rnd);
      this.music = new Music(ctx, this.mix, PALETTE, rnd);
      this.ctx = ctx;
    } catch {
      // No Web Audio: the game stays silent.
      this.ctx = undefined;
    }
    return this.ctx;
  }

  private cue(event: CueEvent, ctx: AudioContext, now: number): void {
    const gap = GAPS_MS[event.cue] ?? MIN_GAP_MS;
    if (now - (this.last.get(event.cue) ?? -Infinity) < gap) return;
    this.last.set(event.cue, now);
    this.player?.play(event.cue, ctx.currentTime + 0.01, this.place(event));
  }

  private place(event: CueEvent): Place {
    const camera = this.camera();
    if (!camera) return placeHere(1);
    if (event.tile === undefined) return placeHere(camera.scale);
    const point = camera.tileToScreen(event.tile);
    return placeFor(
      {
        x: point.x,
        y: point.y,
        width: camera.viewportWidth,
        height: camera.viewportHeight,
        scale: camera.scale,
      },
      event.own,
    );
  }

  /** Keeps the score going while the game is played, and tells it how the game feels. */
  private score(update: GameUpdate, ctx: AudioContext, now: number, wanted: boolean): void {
    const music = this.music;
    if (!music) return;
    const you = update.players.find((p) => p.id === update.you);
    const total = update.players.reduce((sum, player) => sum + player.tiles, 0);
    const share = total > 0 ? (you?.tiles ?? 0) / total : 0;
    let target = 0;
    if (update.attacks.length > 0) target = 0.4 + 0.15 * Math.min(update.attacks.length, 3);
    if (update.missiles.some((missile) => missile.player !== update.you)) {
      target = Math.max(target, 0.85);
    }
    if (now < this.alarmUntil || (update.capitals?.threat ?? 0) > 0) target = Math.max(target, 0.8);
    const seconds = Math.min(1, (now - (this.moodAt || now)) / 1000);
    this.moodAt = now;
    const tau = target > music.mood.intensity ? 3 : 14;
    music.mood = {
      intensity:
        music.mood.intensity + (target - music.mood.intensity) * (1 - Math.exp(-seconds / tau)),
      grandeur: Math.min(1, share * 3.3),
    };

    if (!wanted || update.phase !== "play" || this.over) {
      // No music wanted: the score is not fed, and costs nothing.
      if (this.feed !== undefined) clearInterval(this.feed);
      this.feed = undefined;
      return;
    }
    if (!this.musicOn) {
      this.musicOn = true;
      music.begin(ctx.currentTime + 0.4);
    }
    if (this.feed === undefined) {
      music.resume(ctx.currentTime + 0.2);
      this.feed = setInterval(() => {
        if (this.ctx?.state === "running") music.advance(this.ctx.currentTime + LOOKAHEAD);
      }, FEED_MS);
      music.advance(ctx.currentTime + LOOKAHEAD);
    }
  }
}
