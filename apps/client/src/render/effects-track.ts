import type { CameraView } from "./camera.ts";
import type { UnitMark } from "./renderer.ts";

/*
 * What the combat effects draw and when (art-direction.md, Motion): a trail
 * behind a missile, a wake behind a ship, a flash where a missile lands, a
 * splash where troops land, a ring at a port, sparks along an advancing
 * front. Everything here is read from what the renderer is already given,
 * never from the rules, so a replay or a golden is unaffected. No Three.js:
 * the layer next to this file draws the particles this module asks for.
 */

/** A soft disc, or a thin ring. */
export type Shape = "dot" | "ring";

/** One short-lived mark on the map, in tiles (y counted from the north) and seconds. */
export interface Particle {
  readonly x: number;
  readonly y: number;
  /** Drift in tiles per second. */
  readonly dx: number;
  readonly dy: number;
  readonly birth: number;
  readonly life: number;
  /** Diameter at birth and at death, in tiles. */
  readonly size0: number;
  readonly size1: number;
  /** Smallest diameter on screen in CSS pixels, however far the view is zoomed out. */
  readonly minPixels: number;
  readonly color: string;
  readonly alpha: number;
  readonly shape: Shape;
}

export interface TrackerOptions {
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
}

const MISSILE_RADIUS = 12;
const HEAVY_MISSILE_RADIUS = 30;
/** The tiles the balance gives the blast radii on, 2^19, to scale them to this map. */
const REFERENCE_TILES = 2 ** 19;

const FOAM = "#CFE8F5";
const FLASH = "#FFE2A8";
const GOLD = "#F2C14E";
/** The ember of an active front (territory-layer.ts). */
const EMBER = "#F25C2A";
/** Tiles of depth a collapse takes on a 2^19-tile map, scaled like the blasts (R-ATTACK-10). */
const COLLAPSE_DEPTH = 5;
const COLLAPSE_LIFE = 1;
/** Most collapse bursts alive at once. */
const BURST_CAP = 8;

/** Spacing of the dots of a trail on screen, in CSS pixels. */
const TRAIL_PIXELS = 8;
/** Most effects started by one pass over the ships, so that a jump in a replay is not a firework. */
const BURST_BUDGET = 8;
/** Most sparks started by one batch of changed tiles. */
const FRONT_BUDGET = 10;
/** Tiles of a start region at most, and its radius in tiles on a map of 2^19 tiles (B-SPAWN-RADIUS). */
const ARRIVAL_TILES = 60;
const SPAWN_RADIUS = 3;
/** Seconds between two pulses along a front. */
const PULSE_EVERY = 0.5;
/** Margin around the view in which effects still start, in tiles. */
const VIEW_MARGIN = 4;

interface Seen {
  kind: "transport" | "trade" | "warship" | "missile" | "heavyMissile";
  x: number;
  y: number;
  color: string;
  /** Where the last dot of the trail went. */
  trailX: number;
  trailY: number;
  pass: number;
}

/** Tells the layer which particles to draw as ships, missiles and fronts move. */
export class EffectTracker {
  private readonly known = new Map<number, Seen>();
  private pass = 0;
  private seeded = false;
  private moving = true;
  private view: CameraView | undefined;
  private tilesPerPixel = 1;
  private budget = 0;
  private pulsedAt = -Infinity;
  /** Players whose land has been seen, to tell a first arrival. */
  private readonly owners = new Set<number>();
  private seed = 0x9e3779b9;
  private readonly blast: number;
  /** When the bursts of collapsed fronts still running end, in the layer's seconds. */
  private readonly bursts: number[] = [];

  constructor(
    private readonly emit: (particle: Particle) => void,
    private readonly options: TrackerOptions,
  ) {
    this.blast = Math.sqrt((options.width * options.height) / REFERENCE_TILES);
  }

  /** Whether the player accepts motion: without it, trails stay and the rest holds still. */
  setMotion(moving: boolean): void {
    this.moving = moving;
  }

  /** The view of the last frame, to start effects only where they can be seen. */
  setView(view: CameraView, tilesPerPixel: number): void {
    this.view = view;
    this.tilesPerPixel = tilesPerPixel;
  }

  /** Follows the ships and missiles of one frame; what appeared or vanished since the last one starts an effect. */
  ships(marks: readonly UnitMark[], now: number): void {
    this.budget = BURST_BUDGET;
    const pass = ++this.pass;
    for (const mark of marks) {
      if (mark.id === undefined) continue;
      const kind = mark.kind ?? "transport";
      const seen = this.known.get(mark.id);
      if (!seen) {
        const added: Seen = {
          kind,
          x: mark.x,
          y: mark.y,
          color: mark.color,
          trailX: mark.x,
          trailY: mark.y,
          pass,
        };
        this.known.set(mark.id, added);
        if (this.seeded) this.appeared(added, now);
        continue;
      }
      seen.x = mark.x;
      seen.y = mark.y;
      seen.pass = pass;
      this.trail(seen, now);
    }
    for (const [id, seen] of this.known) {
      if (seen.pass === pass) continue;
      this.known.delete(id);
      this.vanished(seen, now);
    }
    this.seeded = true;
  }

  /** Sparks along the tiles that just changed hands: the front moving. */
  fronts(tiles: ArrayLike<number>, owners: ArrayLike<number>, now: number): void {
    if (!this.view) return;
    const { width } = this.options;
    this.arrivals(tiles, owners, now);
    if (!this.moving) return;
    this.pulse(tiles, owners, now);
    let started = 0;
    let skip = 0;
    // A random start, so that the same tiles of a long front are not always the ones that spark.
    const first = Math.floor(this.random() * 3);
    for (let i = first; i < tiles.length && started < FRONT_BUDGET; i++) {
      if (skip++ % 3 !== 0) continue;
      const tile = tiles[i] as number;
      const owner = owners[tile] as number;
      if (owner === 0) continue;
      const x = (tile % width) + 0.5;
      const y = Math.floor(tile / width) + 0.5;
      if (!this.visible(x, y)) continue;
      started++;
      this.emit({
        x,
        y,
        dx: (this.random() - 0.5) * 0.8,
        dy: -0.6 - this.random() * 0.6,
        birth: now,
        life: 0.8 + this.random() * 0.4,
        size0: 1.2,
        size1: 0.3,
        minPixels: 2.5,
        color: FLASH,
        alpha: 0.55,
        shape: "dot",
      });
    }
  }

  /** A ring where a player's land first appears: a start tile picked, as the spawn phase ends. */
  private arrivals(tiles: ArrayLike<number>, owners: ArrayLike<number>, now: number): void {
    const { width } = this.options;
    const batch = new Map<number, { count: number; x: number; y: number }>();
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i] as number;
      const owner = owners[tile] as number;
      if (owner === 0 || this.owners.has(owner)) continue;
      const entry = batch.get(owner);
      if (entry) entry.count++;
      else batch.set(owner, { count: 1, x: tile % width, y: Math.floor(tile / width) });
    }
    for (const [owner, { count, x, y }] of batch) {
      this.owners.add(owner);
      // A start region is a few dozen tiles; a larger batch is a resynchronisation, not an arrival.
      if (count > ARRIVAL_TILES || !this.visible(x, y)) continue;
      const r = SPAWN_RADIUS * this.blast;
      if (this.moving) this.ring(x, y, now, 1.6, r, r * 5, FLASH, 0.8);
      else this.emit(disc(x, y, now, 1.6, r * 3, r * 3, FLASH, 0.35, 10));
    }
  }

  /** A soft glow that breathes where a front is taking land, at most twice a second. */
  private pulse(tiles: ArrayLike<number>, owners: ArrayLike<number>, now: number): void {
    if (tiles.length === 0 || now - this.pulsedAt < PULSE_EVERY) return;
    const { width } = this.options;
    const tile = tiles[Math.floor(this.random() * tiles.length)] as number;
    const x = tile % width;
    const y = Math.floor(tile / width);
    if (owners[tile] === 0 || !this.visible(x, y)) return;
    this.pulsedAt = now;
    this.emit(disc(x, y, now, 0.9, 5, 9, FLASH, 0.22, 14));
  }

  /**
   * An ember shock ring that grows to the radius of a collapsed front, with a
   * few sparks (R-ATTACK-10). Held still it is one ring that only fades. A
   * burst is skipped outside the view, and at most BURST_CAP run at once, so a
   * replay that jumps ahead is not a firework.
   */
  collapsed(tile: number, now: number): void {
    const { width } = this.options;
    const x = (tile % width) + 0.5;
    const y = Math.floor(tile / width) + 0.5;
    if (!this.visible(x, y)) return;
    // Bursts whose life has run out make room for new ones.
    let live = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      if ((this.bursts[i] as number) > now) this.bursts[live++] = this.bursts[i] as number;
    }
    this.bursts.length = live;
    if (live >= BURST_CAP) return;
    this.bursts.push(now + COLLAPSE_LIFE);
    const radius = COLLAPSE_DEPTH * this.blast;
    if (!this.moving) {
      this.emit({ ...ringOf(x, y, now, radius * 2, radius * 2), alpha: 0.7, life: 1 });
      return;
    }
    this.emit(ringOf(x, y, now, radius * 0.4, radius * 2));
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + this.random() * 0.8;
      const speed = radius * (0.7 + this.random() * 0.5);
      this.emit({
        x,
        y,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        birth: now,
        life: 0.6 + this.random() * 0.3,
        size0: 1.2,
        size1: 0.3,
        minPixels: 3,
        color: i % 2 === 0 ? EMBER : FLASH,
        alpha: 0.9,
        shape: "dot",
      });
    }
  }

  private appeared(unit: Seen, now: number): void {
    if (!this.moving || !this.visible(unit.x, unit.y) || this.budget <= 0) return;
    if (unit.kind === "missile" || unit.kind === "heavyMissile") {
      this.budget--;
      const big = unit.kind === "heavyMissile" ? 1.6 : 1;
      this.ring(unit.x, unit.y, now, 0.8, 1.5 * big, 9 * big, unit.color, 0.8);
    } else if (unit.kind === "trade") {
      // A trade ship leaves its port.
      this.budget--;
      this.ring(unit.x, unit.y, now, 1.1, 0.6, 3.2, unit.color, 0.4);
    }
  }

  private vanished(unit: Seen, now: number): void {
    if (!this.visible(unit.x, unit.y) || this.budget <= 0) return;
    this.budget--;
    if (unit.kind === "missile" || unit.kind === "heavyMissile") {
      this.landed(unit, now);
    } else if (unit.kind === "transport") {
      this.landing(unit, now);
    } else if (unit.kind === "trade") {
      // A trade ship docks: a ring on the port, and a coin that floats up.
      if (!this.moving) return;
      this.ring(unit.x, unit.y, now, 1.1, 0.6, 3.2, unit.color, 0.4);
      this.emit({
        x: unit.x,
        y: unit.y,
        dx: 0,
        dy: -1.4,
        birth: now,
        life: 1.1,
        size0: 1.1,
        size1: 0.5,
        minPixels: 4,
        color: GOLD,
        alpha: 0.85,
        shape: "dot",
      });
    }
  }

  /** The flash, the shock ring and the sparks of a missile that has come down. */
  private landed(unit: Seen, now: number): void {
    const radius =
      (unit.kind === "heavyMissile" ? HEAVY_MISSILE_RADIUS : MISSILE_RADIUS) * this.blast;
    if (!this.moving) {
      // Held still: a single disc that only fades.
      this.emit(disc(unit.x, unit.y, now, 1.4, radius * 1.4, radius * 1.4, FLASH, 0.4, 8));
      return;
    }
    this.emit(disc(unit.x, unit.y, now, 0.4, radius * 0.6, radius * 1.5, FLASH, 0.9, 8));
    this.ring(unit.x, unit.y, now, 1, radius * 0.4, radius * 2, FLASH, 0.95);
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + this.random() * 0.8;
      const speed = radius * (0.6 + this.random() * 0.5);
      this.emit({
        x: unit.x,
        y: unit.y,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        birth: now,
        life: 0.7 + this.random() * 0.3,
        size0: 1.4,
        size1: 0.3,
        minPixels: 3,
        color: i % 2 === 0 ? FLASH : "#FFFFFF",
        alpha: 0.9,
        shape: "dot",
      });
    }
  }

  /** A ring and a few drops where a transport reaches the shore. */
  private landing(unit: Seen, now: number): void {
    if (!this.moving) {
      this.emit(disc(unit.x, unit.y, now, 1, 4, 4, unit.color, 0.45, 8));
      return;
    }
    this.ring(unit.x, unit.y, now, 0.9, 1, 6.5, unit.color, 0.85);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + this.random();
      const speed = 3 + this.random() * 2;
      this.emit({
        x: unit.x,
        y: unit.y,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        birth: now,
        life: 0.55,
        size0: 1,
        size1: 0.3,
        minPixels: 3,
        color: FOAM,
        alpha: 0.8,
        shape: "dot",
      });
    }
  }

  /** The trail of a missile, or the wake of a ship that sails far enough from the last mark. */
  private trail(unit: Seen, now: number): void {
    if (unit.kind === "trade") return;
    const spacing = Math.max(2, TRAIL_PIXELS * this.tilesPerPixel);
    let dx = unit.x - unit.trailX;
    // The short way across the seam of a wrapping map.
    const { width, wrapsX } = this.options;
    if (wrapsX && Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
    const dy = unit.y - unit.trailY;
    if (Math.hypot(dx, dy) < spacing) return;
    unit.trailX = unit.x;
    unit.trailY = unit.y;
    if (!this.visible(unit.x, unit.y)) return;
    const x = unit.x + 0.5;
    const y = unit.y + 0.5;
    if (unit.kind === "missile" || unit.kind === "heavyMissile") {
      // A dotted arc that fades after the landing.
      const big = unit.kind === "heavyMissile" ? 1.4 : 1;
      this.emit({
        x,
        y,
        dx: 0,
        dy: 0,
        birth: now,
        life: 2.4,
        size0: 1.1 * big,
        size1: 0.6 * big,
        minPixels: 3,
        color: unit.color,
        alpha: 0.75,
        shape: "dot",
      });
    } else {
      const big = unit.kind === "warship" ? 1.3 : 1;
      this.emit({
        x,
        y,
        dx: 0,
        dy: 0,
        birth: now,
        life: 1.4,
        size0: 0.9 * big,
        size1: 2.4 * big,
        minPixels: 3,
        color: FOAM,
        alpha: 0.32,
        shape: "dot",
      });
    }
  }

  private ring(
    x: number,
    y: number,
    now: number,
    life: number,
    size0: number,
    size1: number,
    color: string,
    alpha: number,
  ): void {
    if (!this.moving) return;
    this.emit({
      x: x + 0.5,
      y: y + 0.5,
      dx: 0,
      dy: 0,
      birth: now,
      life,
      size0,
      size1,
      minPixels: 10,
      color,
      alpha,
      shape: "ring",
    });
  }

  /** Whether a spot is in the view, with a margin, across the seam of a wrapping map. */
  private visible(x: number, y: number): boolean {
    const view = this.view;
    if (!view) return false;
    let dx = x - view.centerX;
    const { width, wrapsX } = this.options;
    if (wrapsX) dx -= Math.round(dx / width) * width;
    return (
      Math.abs(dx) <= view.halfWidth + VIEW_MARGIN &&
      Math.abs(y - view.centerY) <= view.halfHeight + VIEW_MARGIN
    );
  }

  /** A small seeded generator: the effects are for the eye, and a test needs the same ones twice. */
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 2 ** 32;
  }
}

function disc(
  x: number,
  y: number,
  now: number,
  life: number,
  size0: number,
  size1: number,
  color: string,
  alpha: number,
  minPixels: number,
): Particle {
  return {
    x: x + 0.5,
    y: y + 0.5,
    dx: 0,
    dy: 0,
    birth: now,
    life,
    size0,
    size1,
    minPixels,
    color,
    alpha,
    shape: "dot",
  };
}

function ringOf(x: number, y: number, now: number, size0: number, size1: number): Particle {
  return {
    x,
    y,
    dx: 0,
    dy: 0,
    birth: now,
    life: COLLAPSE_LIFE,
    size0,
    size1,
    minPixels: 10,
    color: EMBER,
    alpha: 0.95,
    shape: "ring",
  };
}
