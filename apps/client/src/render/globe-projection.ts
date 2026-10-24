import type { CameraView, ScreenPoint } from "./camera.ts";

/** Vertical field of view of the globe camera, in degrees. */
export const GLOBE_FOV = 40;

const TAN_HALF_FOV = Math.tan((GLOBE_FOV * Math.PI) / 360);

/** A point of the planet in degrees: latitude north, longitude east. */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

type Vec3 = readonly [number, number, number];

/**
 * Where the globe camera stands and where it looks, for one view. The planet
 * is the unit sphere at the origin; the camera looks at its centre from
 * above the point under the middle of the screen, north up.
 */
export interface GlobePose {
  readonly position: Vec3;
  /** Unit vectors of the screen: right, up, and into it. */
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  /** Distance from the camera to the centre of the planet, in planet radii. */
  readonly distance: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/**
 * The unit vector of a point of the planet. It matches the vertices of
 * three.js's SphereGeometry, whose texture starts at longitude -180 like the
 * columns of a map (WorldGrid.toLatLon): north is +y, longitude 0 is +x.
 */
export function surfacePoint(lat: number, lon: number): Vec3 {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.sin(phi), -Math.cos(phi) * Math.sin(lambda)];
}

/** Latitude and longitude of the tile coordinates (x, y), y counted from the north. */
export function tileToLatLon(x: number, y: number, width: number, height: number): LatLon {
  return { lat: 90 - (y * 180) / height, lon: -180 + (x * 360) / width };
}

/** Tile coordinates of a point, the inverse of tileToLatLon, x in [0, width). */
export function latLonToTile(
  { lat, lon }: LatLon,
  width: number,
  height: number,
): { x: number; y: number } {
  const x = ((lon + 180) / 360) * width;
  return { x: ((x % width) + width) % width, y: ((90 - lat) / 180) * height };
}

/**
 * Distance of the camera for a view. A flat view of half-height h tiles
 * shows vh / 2h pixels per tile; at the middle of the screen the globe gives
 * the same scale to a tile of latitude, which spans pi / height radians:
 * (pi / height) * (vh / 2) / ((d - 1) * tan(fov / 2)) = vh / 2h.
 */
export function globeDistance(halfHeight: number, worldHeight: number): number {
  return 1 + (Math.PI * halfHeight) / (worldHeight * TAN_HALF_FOV);
}

/** The camera for a view of a map of width × height tiles on a viewport in CSS pixels. */
export function globePose(
  view: CameraView,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): GlobePose {
  const { lat, lon } = tileToLatLon(view.centerX, view.centerY, width, height);
  const normal = surfacePoint(lat, lon);
  const distance = globeDistance(view.halfHeight, height);
  const forward: Vec3 = [-normal[0], -normal[1], -normal[2]];
  // North stays up: three.js's lookAt with up = +y gives the same basis.
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return {
    position: [normal[0] * distance, normal[1] * distance, normal[2] * distance],
    right,
    up,
    forward,
    distance,
    viewportWidth: Math.max(1, viewportWidth),
    viewportHeight: Math.max(1, viewportHeight),
  };
}

/** The point of the planet under a screen position, or undefined in space. */
export function pickLatLon(pose: GlobePose, x: number, y: number): LatLon | undefined {
  const { position: p, right, up, forward, viewportWidth, viewportHeight } = pose;
  const sx = ((2 * x) / viewportWidth - 1) * TAN_HALF_FOV * (viewportWidth / viewportHeight);
  const sy = (1 - (2 * y) / viewportHeight) * TAN_HALF_FOV;
  const ray: Vec3 = [
    forward[0] + right[0] * sx + up[0] * sy,
    forward[1] + right[1] * sx + up[1] * sy,
    forward[2] + right[2] * sx + up[2] * sy,
  ];
  // |p + t ray| = 1, the nearer of the two roots.
  const a = dot(ray, ray);
  const b = 2 * dot(p, ray);
  const c = dot(p, p) - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0) return undefined;
  const hit = [p[0] + ray[0] * t, p[1] + ray[1] * t, p[2] + ray[2] * t] as const;
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, hit[1]))) * 180) / Math.PI,
    lon: (Math.atan2(-hit[2], hit[0]) * 180) / Math.PI,
  };
}

/** Where a point of the planet appears on screen, or undefined behind the horizon. */
export function projectLatLon(pose: GlobePose, lat: number, lon: number): ScreenPoint | undefined {
  const point = surfacePoint(lat, lon);
  const { position: p, right, up, forward, viewportWidth, viewportHeight } = pose;
  // Seen from the camera, a point of the unit sphere is in front of the
  // horizon when the camera is above its tangent plane.
  if (dot(point, p) < 1) return undefined;
  const v: Vec3 = [point[0] - p[0], point[1] - p[1], point[2] - p[2]];
  const depth = dot(v, forward);
  if (depth <= 0) return undefined;
  const sx = dot(v, right) / depth / (TAN_HALF_FOV * (viewportWidth / viewportHeight));
  const sy = dot(v, up) / depth / TAN_HALF_FOV;
  return { x: ((sx + 1) * viewportWidth) / 2, y: ((1 - sy) * viewportHeight) / 2 };
}

/**
 * The rays a shader casts for a pose: through the middle of the screen, and
 * how they change from there to the right and top edges.
 */
export function globeRays(pose: GlobePose): {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
} {
  const sx = TAN_HALF_FOV * (pose.viewportWidth / pose.viewportHeight);
  const sy = TAN_HALF_FOV;
  const { right, up } = pose;
  return {
    position: pose.position,
    forward: pose.forward,
    right: [right[0] * sx, right[1] * sx, right[2] * sx],
    up: [up[0] * sy, up[1] * sy, up[2] * sy],
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
}
