import type { UnitMark } from "./renderer.ts";

/*
 * Where a missile is, and where it was, on the arc the map draws it on
 * (art-direction.md, Motion). The rules fly a missile straight from its silo to
 * its target; the screen lifts it north of that line by an altitude that is 0 at
 * both ends and 1 half way, so the eye reads a lob over the land. Pure
 * arithmetic, no Three.js: the layer next to this file turns it into quads, and
 * a test reads it as it is.
 */

/** The map a course is laid on. */
export interface CourseMap {
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
}

/** A missile's whole route in world tiles (x east, y north), as the screen draws it. */
export interface Course {
  /** The silo's tile centre. */
  readonly x: number;
  readonly y: number;
  /** The way to the target, the short way across the seam of a wrapping map. */
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
  /** Tiles the arc rises north of the line at its highest. */
  readonly lift: number;
}

/** A point of a course: where it is on the ground and, lifted, where the missile is. */
export interface Fix {
  readonly gx: number;
  readonly gy: number;
  readonly x: number;
  readonly y: number;
  /** 0 on the ground at either end, 1 at the top of the arc. */
  readonly alt: number;
}

/** Share of the distance the arc rises by, and the most it rises on a map of 2^19 tiles. */
const LIFT_RATIO = 0.16;
const LIFT_CAP = 36;
/** The tiles the balance gives its lengths on, to scale them to this map. */
const REFERENCE_TILES = 2 ** 19;

/** How many times a map's tiles are longer than those of the 2^19 the balance is written for. */
export function blastScale(map: CourseMap): number {
  return Math.sqrt((map.width * map.height) / REFERENCE_TILES);
}

/** The course of a missile mark, or nothing for one that does not say where it goes. */
export function courseOf(mark: UnitMark, map: CourseMap): Course | undefined {
  const { from, to } = mark;
  if (!from || !to) return undefined;
  let dx = to.x - from.x;
  if (map.wrapsX && Math.abs(dx) > map.width / 2) dx -= Math.sign(dx) * map.width;
  // The screen counts y from the north, the world from the south.
  const dy = -(to.y - from.y);
  const length = Math.hypot(dx, dy);
  return {
    x: from.x + 0.5,
    y: map.height - from.y - 0.5,
    dx,
    dy,
    length,
    lift: Math.min(LIFT_RATIO * length, LIFT_CAP * blastScale(map)),
  };
}

/** The missile `s` of the way along its course, from 0 to 1. */
export function fixAt(course: Course, s: number): Fix {
  const gx = course.x + course.dx * s;
  const gy = course.y + course.dy * s;
  const alt = 4 * s * (1 - s);
  return { gx, gy, x: gx, y: gy + course.lift * alt, alt };
}

/** Which way the missile points `s` of the way along, in radians from east, turning north to south. */
export function headingAt(course: Course, s: number): number {
  // The slope of the lift, 4 (1 - 2 s), per unit of the course.
  return Math.atan2(course.dy + course.lift * 4 * (1 - 2 * s), course.dx);
}

/** The way along the ground, in radians from east. */
export function groundHeading(course: Course): number {
  return Math.atan2(course.dy, course.dx);
}

/** A puff of a trail: where it hangs, and how old it is, from 0 to 1. */
export interface Puff {
  readonly x: number;
  readonly y: number;
  readonly age: number;
  /** A number from 0 to 1, fixed for the puff by where it was left, so that it does not shimmer. */
  readonly seed: number;
}

/**
 * The puffs of a trail behind a missile `s` of the way along, newest first:
 * one every `spacing` tiles of the course, back as far as the missile flew in
 * `life` seconds at `speed` tiles a second, and no farther than its launch.
 * `late` seconds have passed since the missile ended, which ages them all.
 */
export function trailOf(
  course: Course,
  s: number,
  speed: number,
  life: number,
  spacing: number,
  late: number,
  emit: (puff: Puff) => void,
): void {
  if (course.length <= 0 || speed <= 0 || spacing <= 0) return;
  const reach = Math.min(s * course.length, speed * (life - late));
  for (let back = 0; back <= reach; back += spacing) {
    const at = s - back / course.length;
    const fix = fixAt(course, at);
    const age = (back / speed + late) / life;
    const seed = fract(Math.sin(at * course.length * 12.9898) * 43758.5453);
    emit({ x: fix.x, y: fix.y, age, seed });
  }
}

function fract(value: number): number {
  return value - Math.floor(value);
}
