import type { GameUpdate } from "../../game/solo-game.ts";

/** Seconds of game time between two samples. */
export const SAMPLE_SECONDS = 5;

/** The most marks kept: a game with more would only crowd the chart. */
const MAX_MARKS = 40;

/** A moment worth a mark on the chart. */
export interface StatsMark {
  tick: number;
  kind: "allied" | "ended" | "betrayed" | "out";
  /** The players it names, `a` first. */
  a: number;
  b: number;
}

/** What the end screen draws: land and troops of every player, sampled over the game. */
export interface StatsHistory {
  ticksPerSecond: number;
  /** Tick of each sample. */
  ticks: number[];
  /** Per sample, tiles by player id. */
  tiles: Uint32Array[];
  /** Per sample, troops by player id. */
  troops: Uint32Array[];
  marks: StatsMark[];
  /** Player names by id, as of the last sample. */
  names: string[];
}

/**
 * Keeps the numbers the end screen charts, from the updates the screen
 * already receives: one sample every few seconds of game time, so a game of
 * an hour holds a few hundred. Game time, not real time: a game played faster
 * or paused samples at the same points.
 */
export class StatsRecorder {
  private readonly ticks: number[] = [];
  private readonly tiles: Uint32Array[] = [];
  private readonly troops: Uint32Array[] = [];
  private readonly marks: StatsMark[] = [];
  private names: string[] = [];
  private nextTick = 0;
  private readonly alive = new Set<number>();

  constructor(private readonly ticksPerSecond: number) {}

  observe(update: GameUpdate): void {
    const { tick, you } = update;
    for (const event of update.events) {
      const mine = event.a === you || event.b === you;
      const kind = event.type;
      if (kind !== "allied" && kind !== "ended" && kind !== "betrayed") continue;
      if (mine) this.mark({ tick, kind, a: event.a, b: event.b });
    }
    for (const player of update.players) {
      if (!player.alive && this.alive.delete(player.id)) {
        // R-BOT-29: hundreds of city-states fall; their marks would crowd out the others.
        if (player.cityState !== true) this.mark({ tick, kind: "out", a: player.id, b: 0 });
      } else if (player.alive) this.alive.add(player.id);
    }
    if (update.phase === "play" && tick >= this.nextTick) this.sample(update);
  }

  private sample(update: GameUpdate): void {
    const { tick } = update;
    this.nextTick = tick + SAMPLE_SECONDS * this.ticksPerSecond;
    const size = update.players.reduce((top, player) => Math.max(top, player.id), 0) + 1;
    const tiles = new Uint32Array(size);
    const troops = new Uint32Array(size);
    this.names = [];
    for (const player of update.players) {
      tiles[player.id] = player.tiles;
      troops[player.id] = Math.floor(player.troops);
      this.names[player.id] = player.name;
    }
    this.ticks.push(tick);
    this.tiles.push(tiles);
    this.troops.push(troops);
  }

  /** The record so far, with the update that closes it as its last sample. */
  finish(update: GameUpdate): StatsHistory {
    if (update.phase === "play" && this.ticks.at(-1) !== update.tick) this.sample(update);
    return {
      ticksPerSecond: this.ticksPerSecond,
      ticks: this.ticks,
      tiles: this.tiles,
      troops: this.troops,
      marks: this.marks,
      names: this.names,
    };
  }

  private mark(mark: StatsMark): void {
    if (this.marks.length < MAX_MARKS) this.marks.push(mark);
  }
}
