import type { GameUpdate } from "../../game/solo-game.ts";
import type { UnitMark } from "../../render/renderer.ts";

/** Offset of warship ids among the ships the screen moves, past any transport's. */
const WARSHIP_IDS = 2 ** 40;
/** Offset of missile ids, past any warship's. */
const MISSILE_IDS = 2 ** 41;
/** Missiles in flight: the brand's bright ember. */
export const MISSILE_COLOR = "#FF7A47";

type Moving = Pick<GameUpdate, "boats" | "tradeShips" | "warships" | "missiles">;

/** Whether anything moves at sea or in the air, which keeps frames coming. */
export function sailing(update: Moving | undefined): boolean {
  return (
    (update?.boats.length ?? 0) +
      (update?.tradeShips.length ?? 0) +
      (update?.warships.length ?? 0) +
      (update?.missiles.length ?? 0) >
    0
  );
}

type ShipKind = NonNullable<UnitMark["kind"]> | "transport";

/** How long a ship that left the sea takes to dock, land its troops or go under, in ms. */
const GHOST_MS = { docking: 1200, landing: 1400, sinking: 2400 } as const;
/** Part of the way a ship's heading turns toward its latest course on each tick. */
const TURN = 0.5;
/** Part of the way a ship's speed moves toward the last tick's on each tick. */
const SPEED_EASE = 0.5;
/** A jump of more ticks than this between two updates is a seek or a reload, not play. */
const MAX_TICK_STEP = 20;
/** Ships going under or landing at once, past which the others just vanish. */
const MAX_GHOSTS = 64;

interface Tracked {
  kind: ShipKind;
  player: number;
  fromTile: number;
  toTile: number;
  /** Heading on the previous tick and now, in radians; see {@link UnitMark.heading}. */
  fromHeading: number;
  toHeading: number;
  /** Whether the ship has moved yet, so that it has a course to speak of. */
  steered: boolean;
  speed: number;
  /** It lands or docks on the next tick. */
  arriving: boolean;
  /** A missile's route: its launch tile and aim, and the ticks it was launched and arrives at. */
  flight?: { from: number; to: number; launchedAt: number; arrivesAt: number; radius: number };
}

interface Ghost {
  id: number;
  tracked: Tracked;
  state: NonNullable<UnitMark["state"]>;
  since: number;
}

/** Smallest signed turn from angle `from` to angle `to`. */
function turn(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Ships glide from where they were on the previous tick to where they are
 * now, over one tick, instead of jumping B-BOAT-SPEED tiles at a time. Each
 * keeps a smoothed heading and a speed, and one that leaves the sea lingers
 * for a moment as docking, landing or sinking, for the layer that draws it.
 */
export class ShipMotion {
  private readonly known = new Map<number, Tracked>();
  private ghosts: Ghost[] = [];
  private tickAt = -1;
  private width = 1;
  private wrapsX = false;
  private ticksPerSecond = 10;

  /** Takes in the ships of an update, once per tick, at `now` ms. */
  tick(
    update: Moving & { tick: number },
    map: { readonly width: number; readonly wrapsX: boolean },
    ticksPerSecond: number,
    now: number,
  ): void {
    if (update.tick === this.tickAt) return;
    const step = update.tick - this.tickAt;
    const playing = this.tickAt >= 0 && step > 0 && step <= MAX_TICK_STEP;
    this.tickAt = update.tick;
    this.width = map.width;
    this.wrapsX = map.wrapsX;
    this.ticksPerSecond = ticksPerSecond;
    if (!playing) {
      this.known.clear();
      this.ghosts = [];
    }
    const seen = new Set<number>();
    const see = (id: number, kind: ShipKind, player: number, tile: number, arriving: boolean) => {
      seen.add(id);
      const tracked = this.known.get(id);
      if (!tracked) {
        this.known.set(id, {
          kind,
          player,
          fromTile: tile,
          toTile: tile,
          fromHeading: 0,
          toHeading: 0,
          steered: false,
          speed: 0,
          arriving,
        });
        return;
      }
      tracked.fromTile = tracked.toTile;
      tracked.toTile = tile;
      tracked.arriving = arriving;
      const { dx, dy } = this.delta(tracked.fromTile, tile);
      if (dx === 0 && dy === 0) {
        tracked.fromHeading = tracked.toHeading;
        tracked.speed *= 1 - SPEED_EASE;
        return;
      }
      const course = Math.atan2(dy, dx);
      const perSecond = Math.hypot(dx, dy) * ticksPerSecond;
      if (tracked.steered) {
        tracked.fromHeading = tracked.toHeading;
        tracked.toHeading += turn(tracked.toHeading, course) * TURN;
        tracked.speed += (perSecond - tracked.speed) * SPEED_EASE;
      } else {
        tracked.steered = true;
        tracked.fromHeading = course;
        tracked.toHeading = course;
        tracked.speed = perSecond;
      }
    };
    for (const ship of update.boats) {
      see(ship.id, "transport", ship.player, ship.tile, ship.arriving === true);
    }
    for (const ship of update.tradeShips) {
      see(-ship.id, "trade", ship.player, ship.tile, ship.arriving === true);
    }
    for (const ship of update.warships)
      see(WARSHIP_IDS + ship.id, "warship", ship.player, ship.tile, false);
    for (const missile of update.missiles) {
      const kind = missile.heavy ? "heavyMissile" : "missile";
      see(MISSILE_IDS + missile.id, kind, missile.player, missile.tile, false);
      const tracked = this.known.get(MISSILE_IDS + missile.id);
      if (tracked) {
        const { from, to, launchedAt, arrivesAt, radius } = missile;
        tracked.flight = { from, to, launchedAt, arrivesAt, radius };
      }
    }
    for (const [id, tracked] of this.known) {
      if (seen.has(id)) continue;
      this.known.delete(id);
      if (!playing || tracked.kind === "missile" || tracked.kind === "heavyMissile") continue;
      if (this.ghosts.length >= MAX_GHOSTS) continue;
      // A transport that reached its last tile lands, a trade ship docks; anything else was sunk.
      const state = !tracked.arriving
        ? "sinking"
        : tracked.kind === "transport"
          ? "landing"
          : "docking";
      this.ghosts.push({ id, tracked, state, since: now });
    }
  }

  /** Forgets every ship, for a new game. */
  reset(): void {
    this.known.clear();
    this.ghosts = [];
    this.tickAt = -1;
  }

  /** Whether a ship is still going down, docking or landing at `now`, which keeps frames coming. */
  busy(now: number): boolean {
    this.ghosts = this.ghosts.filter((g) => now - g.since < GHOST_MS[g.state]);
    return this.ghosts.length > 0;
  }

  /**
   * The ships of this frame; `progress` runs from 0 on the previous tick to 1
   * on the latest, `now` is in ms.
   */
  marks(progress: number, now: number, colorOf: (player: number) => string): UnitMark[] {
    const marks: UnitMark[] = [];
    for (const [id, ship] of this.known) {
      const { dx, dy } = this.delta(ship.fromTile, ship.toTile);
      const fromX = ship.fromTile % this.width;
      const fromY = Math.floor(ship.fromTile / this.width);
      marks.push({
        id,
        x: fromX + dx * progress,
        y: fromY + dy * progress,
        // Missiles in one bright colour, readable over any land.
        color:
          ship.kind === "missile" || ship.kind === "heavyMissile"
            ? MISSILE_COLOR
            : colorOf(ship.player),
        ...(ship.kind === "transport" ? {} : { kind: ship.kind }),
        heading: ship.fromHeading + turn(ship.fromHeading, ship.toHeading) * progress,
        speed: ship.speed,
        ...(ship.flight
          ? { ...this.flight(ship.flight, progress), owner: colorOf(ship.player) }
          : {}),
      });
    }
    for (const ghost of this.ghosts) {
      const { tracked } = ghost;
      const elapsed = (now - ghost.since) / GHOST_MS[ghost.state];
      if (elapsed >= 1) continue;
      marks.push({
        id: ghost.id,
        x: tracked.toTile % this.width,
        y: Math.floor(tracked.toTile / this.width),
        color: colorOf(tracked.player),
        ...(tracked.kind === "transport" ? {} : { kind: tracked.kind }),
        heading: tracked.toHeading,
        speed: 0,
        state: ghost.state,
        progress: elapsed,
      });
    }
    return marks;
  }

  /** A missile's route, and how far along it is between the previous tick and the latest. */
  private flight(
    route: NonNullable<Tracked["flight"]>,
    progress: number,
  ): Pick<UnitMark, "from" | "to" | "flown" | "radius"> {
    const span = Math.max(1, route.arrivesAt - route.launchedAt);
    const flown = (this.tickAt - 1 + progress - route.launchedAt) / span;
    return {
      from: { x: route.from % this.width, y: Math.floor(route.from / this.width) },
      to: { x: route.to % this.width, y: Math.floor(route.to / this.width) },
      flown: Math.min(1, Math.max(0, flown)),
      radius: route.radius,
    };
  }

  /** Tiles from `from` to `to`, the short way across the seam of a wrapping map. */
  private delta(from: number, to: number): { dx: number; dy: number } {
    let dx = (to % this.width) - (from % this.width);
    if (this.wrapsX && Math.abs(dx) > this.width / 2) dx -= Math.sign(dx) * this.width;
    return { dx, dy: Math.floor(to / this.width) - Math.floor(from / this.width) };
  }
}
