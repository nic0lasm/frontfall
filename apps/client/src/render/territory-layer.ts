import * as THREE from "three";
import { MAP_COLORS } from "../palette.ts";
import { FRONT_SECONDS } from "./fronts.ts";
import {
  COAST_REACH,
  TERRAIN_COLORS,
  bakeTerrainColors,
  type Latitudes,
} from "./terrain-colors.ts";
import { takeBakedGround, type BakedGround } from "./prebaked-ground.ts";

export interface TerritoryLayerOptions {
  readonly width: number;
  readonly height: number;
  /** Owner of every tile, row 0 at the north pole. Shared, never copied. */
  readonly owners: Uint16Array;
  /** TileKind of every tile, 0 for water. Turned into ground colours once. */
  readonly terrain: Uint8Array;
  /** Whether the map wraps east-west, drawn as three copies side by side. Default true. */
  readonly wrapsX?: boolean | undefined;
  /** Elevation band on land, depth band on water, 0 to 31. Flat when left out. */
  readonly relief?: Uint8Array | undefined;
  /** Latitudes of the map's south and north edges, which set its climates. */
  readonly latitudes?: Latitudes | undefined;
  /** Which published map this is, and its terrain's checksum: its ground may have been baked ahead. */
  readonly groundSource?: { readonly id: string; readonly sha256: string } | undefined;
  /** Highest owner id the palette must hold. */
  readonly maxOwner: number;
  /**
   * The flat map, for older devices: tiles in one colour each, without the
   * smoothing of coasts and borders, at a fraction of the work per pixel.
   */
  readonly flat?: boolean | undefined;
  /**
   * What the map is drawn on: a plane in tiles (the default), or the unit
   * sphere, for a map whose columns span every longitude from -180 and rows
   * every latitude from the north pole. The sphere is ray-traced on a quad
   * that fills the screen, with the camera given by setGlobePose.
   */
  readonly surface?: "plane" | "sphere" | undefined;
}

/** The globe camera, as the territory layer needs it (globe-projection.ts). */
export interface GlobeRays {
  readonly position: readonly [number, number, number];
  /** Ray through the middle of the screen, and its change to the right and top edges. */
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

/** An attack's front: the brand's ember, the colour of the logo's falling square. */
const FRONT_COLOR = "#F25C2A";

/** How long a tile that changed hands takes to fade into its new colour. */
const FADE_SECONDS = 0.08;

/**
 * The ground baked for a map's terrain, kept for as long as the map is: a renderer made
 * again for the same game, after the switch to the globe or to the lighter graphics,
 * takes it instead of baking it again, a second or more of the page's own thread.
 * A layer scorches its own ground under fallout, so it hands a clean copy over first.
 */
const bakedGrounds = new WeakMap<Uint8Array, BakedGround>();

/** Ground under fallout (R-UNIT-06): a scorched olive, mixed into the land's own colour. */
const FALLOUT = [96, 102, 34] as const;

/** Luminance of lowland ground: the relief lightens owned land above it and darkens it below. */
const GROUND_LEVEL = luminance(MAP_COLORS.land);

const PALETTE_WIDTH = 256;

/**
 * Reach of a tile's vote on who owns the points around it, in tiles: wide
 * enough that borders round off over two tiles; and a stronger vote close to
 * the tile's centre, so a lone tile, which its neighbours would outvote, keeps
 * a patch of its own.
 */
const KERNEL = 1.97;
const CORE = 1.05;

/** Tiles per pixel above which each tile takes its own owner, with no vote. */
const VOTE_PIXEL = 0.95;
/** How far the globe's atmosphere reaches beyond the surface, in planet radii. */
const HALO_WIDTH = 0.06;

/** Each row is tracked as at most 32 column chunks, one bit each. */
const CHUNKS_PER_ROW = 32;
const MIN_CHUNK_WIDTH = 64;
/**
 * Rows sent in one upload once the textures are on the GPU: a call per band
 * of rows rather than per row, as each call has a fixed cost in the browser
 * and the driver, far above that of the few extra texels it carries. Four
 * rows keep a tick on World near 150,000 texels, under the 1 MiB budget.
 */
const BAND_ROWS = 4;

const vertexShader = /* glsl */ `
  uniform vec2 worldSize;
#ifdef SPHERE
  out vec3 vRay;
  uniform vec3 rayForward;
  uniform vec3 rayRight;
  uniform vec3 rayUp;

  void main() {
    // A quad over the whole screen: each pixel casts its own ray at the planet.
    vRay = rayForward + position.x * rayRight + position.y * rayUp;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
#else
  out vec2 vTile;

  void main() {
    // Local x runs over the copies of the world, local y from south to north.
    vTile = vec2(position.x, worldSize.y - position.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
#endif
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp usampler2D;

#ifdef SPHERE
  in vec3 vRay;
  uniform vec3 eye;
  uniform vec3 rayForward;
  uniform vec3 rayRight;
  uniform vec3 rayUp;
#else
  in vec2 vTile;
#endif
  layout(location = 0) out highp vec4 outColor;

  uniform usampler2D owners;
  uniform sampler2D ground;
  uniform sampler2D takenAt;
  uniform sampler2D palette;
  uniform vec2 worldSize;
  uniform bool wrapsX;
  uniform float now;
  uniform float fadeSeconds;
  uniform float frontSeconds;
  uniform float frontMotion;
  uniform vec3 foamColor;
  uniform vec3 frontColor;
  uniform vec3 seaShallow;
  uniform vec3 seaOpen;
  uniform vec3 seaDeep;
  uniform float coastReach;
  uniform float reliefShading;
  uniform float groundLevel;
  uniform uint highlight;
  uniform uint hovered;
  uniform sampler2D heightMap;
  /** Depth of the sea from the map's bathymetry, 0 on the shelf to 1 in the abyss; land reads 0. */
  uniform sampler2D depthMap;
  uniform bool hasDepth;
  uniform vec2 viewport;

  /** The column on the map, across the seam of a map that wraps; a float division, as % is undefined below 0. */
  int wrapColumn(int x) {
    int width = int(worldSize.x);
    return wrapsX ? x - width * int(floor((float(x) + 0.5) / worldSize.x)) : clamp(x, 0, width - 1);
  }

  int clampRow(int y) { return clamp(y, 0, int(worldSize.y) - 1); }

  ivec2 wrapTile(ivec2 tile) { return ivec2(wrapColumn(tile.x), clampRow(tile.y)); }

  uint ownerAt(ivec2 tile) { return texelFetch(owners, wrapTile(tile), 0).r; }

  /** Signed distance to the coast in tiles, land above 0, from the ground's alpha (encodeCoast). */
  /**
   * Distance in tiles from the point to the nearest of the sides marked:
   * east, west, south, north (the flat map's borders).
   */
  float edgeDistance(vec2 f, bvec4 sides) {
    float d = 2.0;
    if (sides.x) d = min(d, 1.0 - f.x);
    if (sides.y) d = min(d, f.x);
    if (sides.z) d = min(d, 1.0 - f.y);
    if (sides.w) d = min(d, f.y);
    return d;
  }

  float coastDistance(float alpha) {
    float r = (alpha * 255.0 - 127.5) / 127.5;
    return sign(r) * r * r * coastReach;
  }

  /** How bright a tile's front is: 1 when just taken, 0 once it has burnt out; the tile is already on the map. */
  float frontOf(ivec2 tile) {
    float age = now - texelFetch(takenAt, tile, 0).r;
    return 1.0 - smoothstep(fadeSeconds, frontSeconds, age);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  /** Smooth value noise, about one bump per unit, between 0 and 1. */
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  vec4 cubicWeights(float v) {
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s = n * n * n;
    float x = s.x;
    float y = s.y - 4.0 * s.x;
    float z = s.z - 4.0 * s.y + 6.0 * s.x;
    return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
  }

  /** The ground's alpha through a cubic B-spline (four bilinear taps): no tile steps in the coast distance. */
  float coastAlphaSmooth(vec2 at, float lod) {
    vec2 coord = at - 0.5;
    vec2 fxy = fract(coord);
    coord -= fxy;
    vec4 xc = cubicWeights(fxy.x);
    vec4 yc = cubicWeights(fxy.y);
    vec4 c = coord.xxyy + vec2(-0.5, 1.5).xyxy;
    vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
    vec4 off = (c + vec4(xc.yw, yc.yw) / s) / worldSize.xxyy;
    float a0 = textureLod(ground, off.xz, lod).a;
    float a1 = textureLod(ground, off.yz, lod).a;
    float a2 = textureLod(ground, off.xw, lod).a;
    float a3 = textureLod(ground, off.yw, lod).a;
    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);
    return mix(mix(a3, a2, sx), mix(a1, a0, sx), sy);
  }

  /** A hash without sin(), which loses its bits for large arguments on many GPUs and turns noise built on it into rings. */
  float hs(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float nz(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), u.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  /** Offset applied to where ownership is read, so the stairs of the tile grid turn into soft bends; gone once a tile is under a pixel. */
  vec2 ownerWarp(vec2 p, float pixel) {
    float k = 1.0 - smoothstep(0.3, ${String(VOTE_PIXEL)}, pixel);
    return k * (0.9 * (vec2(nz(p * 0.45), nz(p * 0.45 + 17.3)) - 0.5) + 0.22 * (vec2(nz(p * 1.3 + 3.0), nz(p * 1.3 + 11.0)) - 0.5));
  }

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  /**
   * Close up only, what a map seen from a low flight shows: plots of fields of uneven sizes
   * with hedges on some of their sides on the plains, and clumps of tree crowns lit from the
   * north-west in the forests. Hashes alone, no texture read; a factor on the albedo, 1 where
   * nothing is added.
   */
  vec3 closeGround(vec2 at, float forest, float hm, float ice, float arid, float pixel) {
    vec3 m = vec3(1.0);
    float open = (1.0 - forest) * (1.0 - smoothstep(0.15, 0.4, hm)) * (1.0 - ice);
    // Farmland comes in broad patches of the green plains, with open meadow between them; none in the deserts.
    float plain = open * (1.0 - arid) * smoothstep(0.32, 0.5, nz(at * 0.045 + 21.0));
    float sand = open * arid;
    if (sand > 0.01) {
      // Dunes: long ripples bent by the wind, a lit and a shaded side.
      float ripple = sin(dot(at, vec2(0.78, 0.62)) * 1.2 + 9.0 * nz(at * 0.09 + 5.0));
      float field = smoothstep(0.3, 0.7, nz(at * 0.06 + 13.0));
      m *= 1.0 + sand * (0.08 * ripple * field + 0.06 * (nz(at * 0.5) - 0.5));
    }
    if (plain > 0.01) {
      // Blocks about four tiles across, turned and bent, each cut once along its length or its width.
      vec2 q = mat2(0.94, 0.34, -0.34, 0.94) * at * 0.26 + 0.9 * vec2(nz(at * 0.07), nz(at * 0.07 + 7.0));
      vec2 cell = floor(q);
      vec2 f = q - cell;
      float h1 = hs(cell + 17.0);
      float h2 = hs(cell + 41.0);
      float cut = 0.3 + 0.4 * hs(cell + 5.0);
      bool across = h2 > 0.5;
      float side = (across ? f.x : f.y) < cut ? 0.0 : 1.0;
      float h3 = hs(cell * 2.0 + side + 3.0);
      vec3 crop = h3 > 0.66 ? vec3(1.12, 1.06, 0.82) : (h3 < 0.3 ? vec3(0.9, 1.05, 0.9) : vec3(1.0));
      // Hedges on the block's sides and on the cut, each kept or left out by a hash.
      vec2 e = min(f, 1.0 - f);
      float toCut = abs((across ? f.x : f.y) - cut);
      float hedgeWidth = max(0.015, 0.4 * pixel);
      float edge = min(min(e.x, e.y), toCut);
      float hedge = (1.0 - smoothstep(hedgeWidth, 2.5 * hedgeWidth, edge)) * step(0.35, h1);
      float furrowFade = 1.0 - smoothstep(0.025, 0.05, pixel);
      float furrow = 1.0 + 0.035 * furrowFade * sin(((across ? f.y : f.x) + h1) * 90.0);
      vec3 fields = crop * (0.93 + 0.14 * h1) * furrow * (1.0 - 0.16 * hedge);
      m = mix(m, fields, plain);
    }
    float treeFade = 1.0 - smoothstep(0.04, 0.09, pixel);
    if (forest > 0.01 && treeFade > 0.0) {
      // Crowns of uneven size, set anywhere in their cell, with clearings where the noise is low.
      vec2 t = at * 1.6;
      vec2 tc = floor(t);
      float r = 0.18 + 0.14 * hs(tc + 3.3);
      vec2 d = t - tc - (vec2(hs(tc), hs(tc + 9.1)) * (1.0 - 2.0 * r) + r);
      float crown = (1.0 - smoothstep(0.75 * r, r, length(d))) * step(0.3, nz(at * 0.7) + 0.35 * hs(tc + 1.7));
      float lightSide = clamp(0.5 - (d.x + d.y) / r * 0.6, 0.0, 1.0);
      m *= mix(1.0, mix(0.8, 0.96 + 0.22 * lightSide, crown), forest * treeFade);
    }
    return m;
  }


  /** An sRGB colour given in 0 to 255, in the linear light the shader works in. */
  vec3 srgb3(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }

  /** The height map through a cubic B-spline (four bilinear taps): smooth slopes, no tile kinks in the lighting. */
  float heightCubic(vec2 at, float lod) {
    vec2 coord = at - 0.5;
    vec2 fxy = fract(coord);
    coord -= fxy;
    vec4 xc = cubicWeights(fxy.x);
    vec4 yc = cubicWeights(fxy.y);
    vec4 c = coord.xxyy + vec2(-0.5, 1.5).xyxy;
    vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
    vec4 off = (c + vec4(xc.yw, yc.yw) / s) / worldSize.xxyy;
    float a0 = textureLod(heightMap, off.xz, lod).r;
    float a1 = textureLod(heightMap, off.yz, lod).r;
    float a2 = textureLod(heightMap, off.xw, lod).r;
    float a3 = textureLod(heightMap, off.yw, lod).r;
    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);
    return mix(mix(a3, a2, sx), mix(a1, a0, sx), sy);
  }

  /** Where the baked relief is read: bent by a few tiles of noise, so the rough outlines of the relief regions turn into ragged ones instead of smooth ovals. Decoration only: the rules keep their tiles. */
  vec2 reliefWarp(vec2 p) {
    return 7.0 * (vec2(nz(p * 0.04), nz(p * 0.04 + 9.7)) - 0.5);
  }

  /**
   * Relief height: the baked hills, raised and lowered by broad noise so a region's edge and peaks are uneven,
   * plus ridged detail on the mountains, in ranges that run together (octaves fade when a pixel gets too big for them).
   * The low-frequency inputs (warp, bend, broad) are worked out once a pixel and shared by its three samples.
   */
  float reliefH(vec2 p, vec2 warp, vec2 bend, float broad, float lod, float pixel, out float raw, out float base) {
    // Close up the spline reads the full-size heights: between two mip levels its taps fall out of step and draw stairs.
    raw = heightCubic(p + warp, lod + 0.6 * smoothstep(0.35, 0.9, pixel));
    float h = raw + (broad - 0.5) * 0.3 * smoothstep(0.05, 0.4, raw);
    base = h;
    float m = smoothstep(0.30, 0.68, h);
    float h0 = h;
    float f1 = smoothstep(2.5, 7.0, 9.0 / pixel);
    float f2 = smoothstep(2.5, 7.0, 4.0 / pixel);
    // Ridges only where there are mountains, hills only on the foothills.
    if (m > 0.0) {
      // Isotropic ridged noise on bent coordinates: ridges that branch into a network, never parallel stripes.
      vec2 q = p + bend;
      float n1 = nz(q * 0.075) * 0.65 + nz(q * 0.16 + 2.0) * 0.35;
      float r1 = 1.0 - abs(2.0 * n1 - 1.0);
      r1 = r1 * r1 * r1;
      float n2 = nz(q * 0.22 + 3.7) * 0.6 + nz(q * 0.47) * 0.4;
      float r2 = 1.0 - abs(2.0 * n2 - 1.0);
      r2 = r2 * r2;
      h += (0.2 * r1 * f1 * (0.55 + 0.9 * broad) + 0.06 * r2 * f2) * m;
    }
    // Rolling hills inside a raised region, not a flat dome; handed over to the
    // ridges gradually, as a sudden switch drew a thin bright line along the foot of every range.
    if (h0 > 0.08 && m < 1.0) {
      float rise = smoothstep(0.08, 0.35, h0);
      h += ((nz(p * 0.09 + 2.0) - 0.5) * 0.09 * f1 + (nz(p * 0.33 + 4.0) - 0.5) * 0.05 * f2) * rise * (1.0 - m);
    }
    return h;
  }

  /** Share of the nearby screen (rings of 1.5 to 9 px) held by another owner or the sea: 0 inside, about 0.5 on a straight border. */
  float ringShare(vec2 at, uint owner, float pixel) {
    // Far from any border all eight points of the outer ring agree: nothing nearer to measure.
    float outside = 0.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7853982 + 1.17;
      outside += ownerAt(ivec2(floor(at + vec2(cos(a), sin(a)) * 9.0 * pixel))) != owner ? 1.0 : 0.0;
    }
    if (outside == 0.0) return 0.0;
    float acc = 0.0;
    for (int r = 0; r < 4; r++) {
      float rad = (r == 0 ? 1.5 : (r == 1 ? 3.5 : (r == 2 ? 6.0 : 9.0))) * pixel;
      float m = 0.0;
      for (int k = 0; k < 8; k++) {
        float a = float(k) * 0.7853982 + float(r) * 0.39;
        m += ownerAt(ivec2(floor(at + vec2(cos(a), sin(a)) * rad))) != owner ? 1.0 : 0.0;
      }
      acc += m / 8.0;
    }
    return acc / 4.0;
  }

#ifdef SPHERE
  /** The halo of air around the planet seen past its edge: false where the ray passes too far for it. */
  /**
   * Where the sun stands, seen from the planet: over the viewer's left
   * shoulder, so the face turned to the camera is lit and the far limb falls
   * into a soft shade, whatever way the globe is turned.
   */
  vec3 sunDirection() {
    return normalize(-0.75 * normalize(rayForward) + 0.5 * normalize(rayUp) - 0.45 * normalize(rayRight));
  }

  /** The sky around the planet: blue-black, with sparse stars fixed to the planet's frame. */
  vec3 space(vec3 ray) {
    vec2 sc = vec2(atan(ray.z, ray.x), asin(clamp(ray.y, -1.0, 1.0))) * 90.0;
    vec3 sky = vec3(0.0016, 0.0028, 0.0058);
    vec2 cell = floor(sc);
    float h = hs(cell + 3.1);
    if (h > 0.965) {
      // A pixel's size in these units, from the camera's field of view: no derivatives off the planet.
      float pxSize = 180.0 * length(rayUp) / (length(rayForward) * max(viewport.y, 1.0));
      vec2 d = (sc - cell - (0.15 + 0.7 * vec2(hs(cell + 7.7), hs(cell + 1.3)))) / max(pxSize, 1e-4);
      float bright = pow((h - 0.965) / 0.035, 4.0);
      vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.88, 0.72), hs(cell + 5.0));
      sky += tint * exp(-dot(d, d) * 0.9) * (0.06 + 1.2 * bright);
    }
    return sky;
  }

  bool atmosphere(vec3 origin, vec3 ray, out vec4 shade) {
    vec3 nearest = origin - dot(origin, ray) * ray;
    float halo = clamp(1.0 - (length(nearest) - 1.0) / ${String(HALO_WIDTH)}, 0.0, 1.0);
    // Brighter on the side of the sun, faint on the other.
    float lit = 0.3 + 0.9 * max(dot(normalize(nearest), sunDirection()), 0.0);
    shade = linearToOutputTexel(vec4(mix(space(ray), vec3(0.30, 0.55, 1.0), min(1.0, halo * halo * 0.6 * lit)), 1.0));
    return true;
  }
#endif

  void main() {
  #ifdef SPHERE
    // Where the ray meets the unit sphere. Off the planet the root is clamped
    // rather than skipped, so the derivatives stay defined up to the rim.
    vec3 ray = normalize(vRay);
    float b = dot(eye, ray);
    float hit = b * b - dot(eye, eye) + 1.0;
    float rim = 2.0 * fwidth(hit);
    vec3 point = normalize(eye + (-b - sqrt(max(hit, 0.0))) * ray);
    float lat = asin(clamp(point.y, -1.0, 1.0));
    float lon = atan(-point.z, point.x);
    vec2 at = vec2((lon / 6.2831853 + 0.5) * worldSize.x, (0.5 - lat / 3.1415927) * worldSize.y);
    // Rows keep their size on the sphere; columns narrow toward the poles, and
    // their coordinate jumps across the antimeridian, so only rows give the scale.
    float pixel = max(fwidth(at.y), 1e-4);
  #else
    vec2 at = vTile;
    // Tiles per screen pixel, for lines that stay sharp and visible at any zoom.
    float pixel = max(fwidth(at.x), 1e-4);
  #endif
  #ifdef FLAT
    // The flat map: each tile in one colour, borders along the edges of tiles.
    ivec2 tile = wrapTile(ivec2(floor(at)));
    vec2 f = fract(at);
    uint owner = ownerAt(tile);
    uvec4 around = uvec4(ownerAt(tile + ivec2(1, 0)), ownerAt(tile - ivec2(1, 0)),
      ownerAt(tile + ivec2(0, 1)), ownerAt(tile - ivec2(0, 1)));
    bvec4 other = notEqual(around, uvec4(owner));
    bvec4 touch = bvec4(vec4(other) * vec4(greaterThan(around, uvec4(0u))));
    float ownerEdge = edgeDistance(f, other);
    float contactEdge = edgeDistance(f, touch);
    vec4 groundSample = texelFetch(ground, tile, 0);
    float coast = coastDistance(groundSample.a);
    float landCover = step(0.0, coast);
    float detail = 0.0;
  #else
    // Who owns the point: each land tile within KERNEL tiles of it votes for
    // its owner, the nearer the louder, so borders run in curves through the
    // tiles instead of along their edges, and a lone tile still keeps a round
    // patch. Water has no vote: the coast, drawn from the ground, ends a
    // country wherever it runs.
    vec2 ato = at + ownerWarp(at, pixel);
    uint owner;
    ivec2 tile = wrapTile(ivec2(floor(ato)));
    float ownerEdge = 2.0;
    float contactEdge = 2.0;
    // Distance to another owner's land (and to a player's) over a few tiles,
    // beyond the vote's reach; 9 where none is near, a real distance rather
    // than a marker, so wide lines never mistake it for a border.
    float ownerWide = 9.0;
    float contactWide = 9.0;
    if (pixel > ${String(VOTE_PIXEL)}) {
      // Zoomed out, a tile is under two pixels and curves would hardly show,
      // for the dearest part of the shader: each tile takes its own owner and
      // borders follow its edges, as on the flat map.
      owner = ownerAt(tile);
      uvec4 around = uvec4(ownerAt(tile + ivec2(1, 0)), ownerAt(tile - ivec2(1, 0)),
        ownerAt(tile + ivec2(0, 1)), ownerAt(tile - ivec2(0, 1)));
      bvec4 other = notEqual(around, uvec4(owner));
      bvec4 touch = bvec4(vec4(other) * vec4(greaterThan(around, uvec4(0u))));
      ownerEdge = edgeDistance(fract(ato), other);
      contactEdge = edgeDistance(fract(ato), touch);
    } else {
      vec2 p = ato - 0.5;
      ivec2 base = ivec2(floor(p)) - 1;
      // The four columns and rows of the sixteen tiles, wrapped once each
      // rather than once per tile: this loop is most of the shader's work.
      ivec4 columns = ivec4(wrapColumn(base.x), wrapColumn(base.x + 1), wrapColumn(base.x + 2), wrapColumn(base.x + 3));
      ivec4 rows = ivec4(clampRow(base.y), clampRow(base.y + 1), clampRow(base.y + 2), clampRow(base.y + 3));
      // Most of the map lies inside one owner's land, or nobody's: when the
      // sixteen tiles agree, the votes are skipped.
      uint around[16];
      bool same = true;
      for (int k = 0; k < 16; k++) {
        around[k] = texelFetch(owners, ivec2(columns[k % 4], rows[k / 4]), 0).r;
        same = same && around[k] == around[0];
      }
      owner = around[0];
      if (!same) {
        uint candidates[6] = uint[6](0u, 0u, 0u, 0u, 0u, 0u);
        float scores[6] = float[6](0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        ivec2 nearestTile[6];
        float nearestWeight[6] = float[6](0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        int count = 0;
        for (int k = 0; k < 16; k++) {
          ivec2 cell = base + ivec2(k % 4, k / 4);
          vec2 offset = ato - (vec2(cell) + 0.5);
          float d2 = dot(offset, offset);
          float wide = max(0.0, 1.0 - d2 / ${String(KERNEL * KERNEL)});
          float near = max(0.0, 1.0 - d2 / ${String(CORE * CORE)});
          float w = wide * wide + 0.5 * near * near;
          if (w <= 0.0) continue;
          ivec2 wrapped = ivec2(columns[k % 4], rows[k / 4]);
          uint who = around[k];
          // Owned tiles are land; only nobody's needs the ground to tell land from sea.
          if (who == 0u && texelFetch(ground, wrapped, 0).a <= 0.5) continue;
          int slot = count;
          for (int c = 0; c < 6; c++) if (c < count && candidates[c] == who) slot = c;
          if (slot == count && count < 6) {
            candidates[slot] = who;
            count++;
          }
          if (slot < 6) {
            scores[slot] += w;
            if (w > nearestWeight[slot]) {
              nearestWeight[slot] = w;
              nearestTile[slot] = wrapped;
            }
          }
        }
        int best = 0;
        for (int c = 1; c < 6; c++) if (c < count && scores[c] > scores[best]) best = c;
        float second = 0.0;
        uint neighbour = 0u;
        for (int c = 0; c < 6; c++) {
          if (c < count && c != best && scores[c] > second) {
            second = scores[c];
            neighbour = candidates[c];
          }
        }
        owner = count > 0 ? candidates[best] : 0u;
        if (count > 0) tile = nearestTile[best];
        // 0 on the border, 1 where nobody else is near. Across a straight border
        // it grows by about two per tile, so half of it is the distance in tiles,
        // up to the reach of the votes.
        float ownerGap = second > 0.0 ? (scores[best] - second) / (scores[best] + second) : 1.0;
        ownerEdge = ownerGap > 0.99 ? 2.0 : 0.5 * ownerGap;
        // Where another player's land lies across the border, rather than bare ground or sea.
        contactEdge = neighbour != 0u ? ownerEdge : 2.0;
      }
    }

    // A ring of sixteen samples around the point, 1 to 3 tiles out: how far
    // the nearest land of another owner, or of another player, lies, beyond
    // the reach of the vote. Only where the vote is off and lines are wider
    // than a tile's own edges reach.
    if (owner != 0u && pixel > ${String(VOTE_PIXEL)}) {
      ivec2 offs[16] = ivec2[16](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1),
        ivec2(2, 0), ivec2(-2, 0), ivec2(0, 2), ivec2(0, -2), ivec2(3, 0), ivec2(-3, 0), ivec2(0, 3), ivec2(0, -3));
      for (int k = 0; k < 16; k++) {
        ivec2 c = ivec2(floor(ato)) + offs[k];
        uint o = ownerAt(c);
        if (o == owner) continue;
        // From the point to the tile's square.
        vec2 gap = max(max(vec2(c) - ato, ato - (vec2(c) + 1.0)), 0.0);
        float d = length(gap);
        ownerWide = min(ownerWide, d);
        if (o != 0u) contactWide = min(contactWide, d);
      }
    }

    // The ground, filtered between tile centres so hills and coasts are smooth.
    // Its level of detail follows the zoom, given rather than derived, because
    // the globe's columns jump at the antimeridian. Zoomed in, the coast
    // distance goes through a cubic B-spline, so it has no steps of tiles.
    float groundLod = max(0.0, log2(pixel));
    vec4 groundSample = textureLod(ground, at / worldSize, groundLod);
    float coastAlpha = coastAlphaSmooth(at, groundLod);
    float coast = coastDistance(coastAlpha);
    float coastPixels = coast / max(fwidth(coast), 1e-4);
    // Land above the coast, with an edge one pixel soft.
    float landCover = clamp(coastPixels + 0.5, 0.0, 1.0);
    // Close up, a fine mottling, finer than a tile, keeps the ground from
    // looking blurred; it fades out before it could shimmer.
    // Both are left out at sea, where the land they shade is not drawn.
    float detail = 0.0;
    if (pixel < 0.5 && landCover > 0.0) detail = (noise(at * 1.7) * 0.6 + noise(at * 4.1) * 0.4 - 0.5) * (1.0 - smoothstep(0.15, 0.5, pixel));
    // Closer still, a finer grain, so a tile filling the screen is not a smear.
    if (pixel < 0.12 && landCover > 0.0) detail += (noise(at * 11.0) - 0.5) * 0.6 * (1.0 - smoothstep(0.04, 0.12, pixel));
  #endif
  #ifdef SPHERE
    // Pixels clear of the rim stop here, once every derivative is taken: after
    // a discard, derivatives are undefined on some GPUs. Those next to it go
    // on, so the rim keeps its derivatives.
    if (hit < -rim) {
    #ifdef SPHERE
      // Off the planet: a thin halo of atmosphere where the ray passes close to its edge.
      if (!atmosphere(eye, ray, outColor)) discard;
      return;
    #else
      discard;
    #endif
    }
  #endif

    vec3 color;
  #ifdef FLAT
    // Open water is one calm colour that deepens slowly offshore. Along every
    // coast runs a crisp band of shallows, about a tile wide close up and a
    // few pixels zoomed out, edged with a fine line of foam.
    float depth = max(-coast, 0.0);
    vec3 sea = mix(mix(seaOpen, seaShallow, 0.25), seaOpen, smoothstep(2.0, 16.0, depth));
    sea = mix(sea, seaDeep, smoothstep(12.0, 40.0, depth));
    float shelf = max(0.9, 3.0 * pixel);
    float shallows = 1.0 - smoothstep(shelf - max(0.2, pixel), shelf, depth);
    // Lighter toward the shore, so the band reads as water getting shallow.
    sea = mix(sea, mix(seaShallow, foamColor, 0.3 * (1.0 - clamp(depth / shelf, 0.0, 1.0))), shallows);
    // Close up, the open water moves: two slow swells drift across each
    // other. They hold still with less motion, and fade out before they
    // could shimmer. Left out on land and in the shallows, where they do not show.
    float swellFade = 1.0 - smoothstep(0.2, 0.6, pixel);
    if (swellFade > 0.0 && landCover < 1.0 && shallows < 1.0) {
      float t = now * frontMotion;
      float swell = noise(at * 0.45 + t * vec2(0.09, 0.04)) + noise(at * 0.9 - t * vec2(0.05, 0.08)) - 1.0;
      sea *= 1.0 + 0.12 * swell * swellFade * (1.0 - shallows);
    }
    float foamWidth = max(0.12, 1.1 * pixel);
    float foam = 1.0 - smoothstep(0.5 * foamWidth, foamWidth, depth);
    sea = mix(sea, foamColor, foam * 0.6);
    // The shore is a tone lighter, so coasts read at any zoom.
    vec3 land = groundSample.rgb * (1.0 + 0.16 * detail) * (1.0 + 0.18 * (1.0 - smoothstep(0.0, max(0.35, 2.0 * pixel), max(coast, 0.0))));
    color = mix(sea, land, landCover);

    // Distance in tiles to the edge of the owner's land: another owner's, or the sea.
    float edge = ownerEdge;
    float contactDistance = contactEdge;

    if (owner != 0u) {
      ivec2 entry = ivec2(int(owner % ${String(PALETTE_WIDTH)}u), int(owner / ${String(PALETTE_WIDTH)}u));
      vec4 paletteTexel = texelFetch(palette, entry, 0);
      vec3 ownerColor = paletteTexel.rgb;
      // Allies of the player are flagged in the palette's alpha (setAllies).
      bool allied = paletteTexel.a < 0.75;
      // Zoomed in, the fill lets the relief through; zoomed out, it is solid, so
      // small countries keep their colour and the edge is one clean pixel.
      float zoomedOut = smoothstep(0.4, 1.5, pixel);
      // The relief shades the owner's colour, which is laid over the ground
      // rather than painted on it: hills stay visible, and pale colours stay
      // apart from the grey of the mountains.
      float relief = clamp(dot(land, vec3(0.2126, 0.7152, 0.0722)) / groundLevel, 0.8, 1.15);
      vec3 fillColor = mix(land, ownerColor * mix(mix(1.0, relief, reliefShading), 1.0, zoomedOut), mix(0.74, 0.94, zoomedOut));
      // The land under the pointer is lit whole, wherever its pieces lie.
      bool pointed = owner == hovered;
      if (pointed) fillColor = mix(fillColor, vec3(1.0), 0.25);
      // The player's own land has a wider, whiter rim, to find it on a crowded map.
      bool mine = owner == highlight;
      bool wide = mine || allied || pointed;
      // Edges are a fraction of a tile, but no more than a few pixels when zoomed right in.
      float width = wide ? max(2.5 * pixel, min(0.4, 8.0 * pixel)) : max(1.5 * pixel, min(0.22, 5.0 * pixel));
      // Three edges, told apart without colour: a thin dark line of the owner's
      // colour at the edge of its land, the same line plus surf on a coast, and
      // between two players a front, 1.7 times wider, with a light ridge on top.
      // Pale colours get a darker edge, so they keep an outline on sand and snow.
      float ownerLight = dot(ownerColor, vec3(0.2126, 0.7152, 0.0722));
      vec3 lineColor = wide ? mix(ownerColor, vec3(1.0), 0.75) : ownerColor * mix(0.38, 0.2, smoothstep(0.35, 0.75, ownerLight));
      vec3 ridgeColor = wide ? lineColor : mix(ownerColor, vec3(1.0), 0.45);
      float contactWidth = 1.7 * width;
      float border = 1.0 - smoothstep(width - pixel, width, edge);
      float contact = 1.0 - smoothstep(contactWidth - pixel, contactWidth, contactDistance);
      // An ally's rim is as wide, in dashes about eight pixels long.
      float dash = allied ? step(0.5, fract((at.x + at.y) / (16.0 * pixel))) : 1.0;
      vec3 owned = mix(fillColor, lineColor, border * dash);
      // Dark colours are close to the ground in brightness: a light rim, one
      // pixel wide, inside their dark edge keeps them apart from it in very
      // low vision or in sunlight. Pale colours stand out on their own.
      if (!wide && ownerLight < 0.3) {
        float rimWidth = width + max(0.15, pixel);
        float rim = (1.0 - smoothstep(rimWidth - pixel, rimWidth, edge)) * (1.0 - border);
        owned = mix(owned, mix(ownerColor, vec3(1.0), 0.6), rim * dash);
      }
      owned = mix(owned, mix(lineColor * 0.5, ridgeColor, smoothstep(0.4 * contactWidth, 0.5 * contactWidth, contactDistance)), contact * dash);
      float age = now - texelFetch(takenAt, tile, 0).r;
      // Land taken in the last moments marks the front of an attack, the
      // strongest signal on the map: its edge turns to ember and light stripes
      // that march along it, readable on any colour and without colour, and
      // the strip behind it glows ember and pulses (steady with less motion).
      // Zoomed out, where a tile is under a pixel and edges vanish, the strip
      // takes the stripes instead.
      float front = 1.0 - smoothstep(fadeSeconds, frontSeconds, age);
      if (front > 0.0) {
        float march = fract((at.x + at.y) / (14.0 * pixel) - now * 1.6 * frontMotion);
        vec3 stripes = step(0.5, march) > 0.0 ? vec3(1.0, 0.96, 0.86) : frontColor;
        float pulse = mix(0.75, 0.5 + 0.5 * sin(now * 7.0), frontMotion);
        vec3 wake = mix(frontColor, stripes, zoomedOut);
        owned = mix(owned, wake, front * front * mix(0.35 + 0.3 * pulse, 0.7, zoomedOut));
        float frontWidth = max(0.6, 3.5 * pixel);
        float frontEdge = 1.0 - smoothstep(frontWidth - pixel, frontWidth, edge);
        owned = mix(owned, stripes, front * frontEdge);
      }
      // A tile taken a moment ago fades in, so fronts creep instead of jumping each tick.
      color = mix(color, owned, smoothstep(0.0, fadeSeconds, age) * landCover);
    }
  #else
    // The map as a table of stained glass: lit relief, each country a tint of
    // translucent glass in a dark lead line, fronts as embers, a living sea.
    float zoomedOut = smoothstep(0.4, 1.5, pixel);
    float lod = max(0.0, log2(pixel));
    float t = now * frontMotion;
    float coastIn = max(coast, 0.0);
    float depth = max(-coast, 0.0);
    float age = now - texelFetch(takenAt, tile, 0).r;
    float fadeIn = smoothstep(0.0, fadeSeconds, age);
    // Direction of an attack here: out of the owner's land toward the border.
    float edgeL = min(pixel > ${String(VOTE_PIXEL)} ? min(ownerEdge, ownerWide) : ownerEdge, coastIn);
    vec2 gradient = vec2(dFdx(edgeL), -dFdy(edgeL));
    vec2 inward = length(gradient) > 1e-5 ? normalize(gradient) : vec2(0.0, 1.0);
    // Distances come with 2 as "nothing near": make that a real far value.
    float oe = ownerEdge > 1.99 ? 9.0 : ownerEdge;
    float ce = contactEdge > 1.99 ? 9.0 : contactEdge;
    float lineOwn = pixel > ${String(VOTE_PIXEL)} ? min(oe, ownerWide) : oe;
    float lineContact = pixel > ${String(VOTE_PIXEL)} ? min(ce, contactWide) : ce;
    float fineFade = 1.0 - smoothstep(0.5, 1.4, pixel);

    // Land: patchy plains, canopy forests, lit ridges.
    float hm = 0.0;
    float shade = 1.0;
    float forest = 0.0;
    float canopy = 0.5;
    vec3 albedo = groundSample.rgb;
    vec3 landColor = albedo;
    if (landCover > 0.0) {
      float eN = clamp(pixel, 0.12, 0.5);
      vec2 warp = reliefWarp(at);
      // The same two noises, rescaled, bend the ridges and raise or lower the ground.
      vec2 bend = 1.15 * warp.yx;
      float broad = 0.5 + (warp.x + warp.y) / 14.0;
      float raw;
      float hb;
      float h0 = reliefH(at, warp, bend, broad, lod, pixel, raw, hb);
      float rawSide;
      float baseSide;
      float hx = reliefH(at + vec2(eN, 0.0), warp, bend, broad, lod, pixel, rawSide, baseSide);
      float hy = reliefH(at + vec2(0.0, eN), warp, bend, broad, lod, pixel, rawSide, baseSide);
      hm = smoothstep(0.30, 0.68, h0);
      // Hills are lit gently, mountains steeply: the edge of a hill region is a soft swell, not a cliff around an oval.
      float rocky = smoothstep(0.55, 0.85, h0);
      float relief = mix(6.0, 13.0, rocky);
      vec3 normal = normalize(vec3(-(hx - h0) / eN * relief, -(hy - h0) / eN * relief, 1.0));
      vec3 sun = normalize(vec3(-0.62, -0.62, 0.50));
      float lit = dot(normal, sun) / sun.z;
      // Folds: how far the relief here sits below its surroundings, read from the smooth heights (bilinear taps made a checkerboard close up).
      float fold = pixel > 1.0 ? 0.0 : max(0.0, heightCubic(at + warp, lod + 2.6) - raw);
      shade = clamp(1.0 + (lit - 1.0) * mix(0.8, 1.55, hm) - fold * 1.6, 0.5, 1.32);
      vec3 base = groundSample.rgb;
      float baseLight = luma(base);
      float v1 = nz(at * 0.11) * 0.6 + nz(at * 0.31) * 0.4;
      float v2 = fineFade > 0.0 ? nz(at * 1.15) * fineFade : 0.0;
      albedo = base * (0.78 + 0.44 * v1) * (0.92 + 0.16 * v2);
      albedo = mix(albedo, albedo * vec3(1.14, 1.02, 0.78), 0.55 * smoothstep(0.45, 0.8, nz(at * 0.06 + 3.0)));
      forest = (1.0 - smoothstep(0.05, 0.1, baseLight)) * smoothstep(0.9, 1.25, base.g / max(base.r, 0.01));
      canopy = forest > 0.0 && fineFade > 0.0 ? nz(at * 2.4) * 0.55 + nz(at * 6.3) * 0.45 : 0.5;
      albedo *= mix(1.0, 0.62 + 0.75 * mix(0.5, canopy, fineFade), forest);
      albedo = mix(albedo, albedo * vec3(0.86, 1.1, 0.9), forest * 0.5);
      // Mountains: rock in the valleys and on the slopes, pale crests, a little snow on the highest.
      float crest = clamp((h0 - hb) / 0.22, 0.0, 1.0);
      float steep = 1.0 - normal.z;
      // Warm earthy rock, alpine meadow left on the gentle slopes, snow only on the high crests.
      vec3 rock = srgb3(96.0, 88.0, 78.0);
      vec3 rockLight = srgb3(150.0, 139.0, 122.0);
      // Bare rock belongs to the mountains; hills keep their grass and only show stone on their steep sides.
      // Ice caps and polar ground come baked white: they keep their ice, never turn to rock.
      float ice = smoothstep(0.42, 0.62, baseLight);
      shade = mix(shade, 1.0 + (shade - 1.0) * 0.25, ice);
      float bare = (rocky * (0.3 + 0.45 * smoothstep(0.03, 0.18, steep)) + (hm - rocky) * 0.35 * smoothstep(0.1, 0.3, steep)) * (1.0 - ice);
      albedo = mix(albedo, mix(rock, rockLight, crest) * (0.9 + 0.2 * nz(at * 0.4)), bare);
      albedo *= 1.0 - 0.16 * rocky * (1.0 - crest);
      float snow = smoothstep(0.88, 1.0, hb + 0.1 * crest) * smoothstep(0.5, 0.9, crest + 0.3 * nz(at * 0.5));
      albedo = mix(albedo, srgb3(214.0, 220.0, 228.0), max(hm * snow * 0.8, ice * 0.5));
      // Close up, fields, crowns and stones, faded in before they could shimmer.
      float close = 1.0 - smoothstep(0.08, 0.18, pixel);
      // Sand and dry steppe: reddish, not green.
      float arid = smoothstep(1.02, 1.25, base.r / max(base.g, 1e-3)) * (1.0 - forest);
      if (close > 0.0) albedo *= mix(vec3(1.0), closeGround(at, forest, hm, ice, arid, pixel) * (1.0 - bare) + vec3(bare), close);
      // Warm light on the slopes facing the sun, cool shade in the folds: depth without chrome.
      vec3 tint = mix(vec3(0.9, 0.94, 1.04), vec3(1.05, 1.0, 0.9), smoothstep(0.7, 1.25, shade));
      landColor = albedo * shade * mix(vec3(1.0), tint, 0.35 + 0.65 * hm);
      landColor *= 1.0 + 0.2 * detail * fineFade;
      landColor *= 1.0 + 0.2 * (1.0 - smoothstep(0.0, max(0.3, 1.6 * pixel), coastIn));
    }

    // Sea: the map's own bathymetry (shelf, slope, deep, abyss), clear shallows
    // along the shore, a slow swell, surf and a wave creeping in close up.
    vec3 seaColor = vec3(0.0);
    if (landCover < 1.0) {
      float shelfWidth = max(1.4, 4.5 * pixel);
      float bathy = hasDepth ? textureLod(depthMap, at / worldSize, lod).r : 0.0;
      float onShelf = hasDepth ? smoothstep(0.02, 0.5, bathy) : smoothstep(0.5 * shelfWidth, 2.2 * shelfWidth + 3.0, depth);
      float abyss = hasDepth ? smoothstep(0.3, 1.0, bathy) : smoothstep(8.0, 40.0, depth);
      vec3 shallow = srgb3(40.0, 124.0, 140.0);
      vec3 shelf = srgb3(19.0, 70.0, 92.0);
      seaColor = mix(shallow, shelf, smoothstep(0.0, shelfWidth, depth));
      seaColor = mix(seaColor, srgb3(11.0, 40.0, 66.0), onShelf);
      seaColor = mix(seaColor, srgb3(6.0, 20.0, 38.0), abyss);
      // Large, slow patches of tone so the open sea is never one flat colour.
      float tone = nz(at * 0.035 + 11.0) - 0.5;
      seaColor *= 1.0 + 0.14 * tone * smoothstep(1.0, 6.0, depth);
      seaColor *= 1.0 - 0.1 * exp(-depth / max(0.4, 1.4 * pixel));
      // The swell, surf and waves cost noise: only where they can be seen.
      float swellFade = (1.0 - smoothstep(0.25, 1.1, pixel)) * smoothstep(0.6, 4.0, depth);
      if (swellFade > 0.0) {
        float swell = nz(at * 0.22 + t * vec2(0.05, 0.02)) + nz(at * 0.5 - t * vec2(0.03, 0.06)) - 1.0;
        seaColor *= 1.0 + 0.16 * swell * swellFade;
      }
      float foamEdge = max(0.07, 1.25 * pixel);
      float spacing = max(0.55, 11.0 * pixel);
      if (depth < max(foamEdge, 2.6 * spacing)) {
        float foamBreak = 0.55 + 0.9 * nz(at * 1.3 + t * vec2(0.12, 0.05));
        float surf = (1.0 - smoothstep(0.35 * foamEdge, foamEdge, depth)) * min(1.0, foamBreak + 0.35);
        surf *= mix(1.0, 0.55, smoothstep(0.5, 1.2, pixel));
        float phase = fract(depth / spacing - t * 0.11);
        float wave = exp(-phase * 15.0) * smoothstep(0.0, 0.04, phase) * (1.0 - smoothstep(0.0, 2.6 * spacing, depth)) * smoothstep(0.25 * spacing, 0.7 * spacing, depth);
        // Only close up: farther out the wave read as a contour line around every coast.
        wave *= smoothstep(0.45, 0.95, foamBreak) * (1.0 - smoothstep(0.12, 0.3, pixel));
        seaColor = mix(seaColor, foamColor * 1.05, clamp(surf * 0.8 + wave * 0.3, 0.0, 1.0));
      }
      seaColor += foamColor * 0.03 * exp(-depth / max(0.7, 1.6 * pixel));
    }
    color = mix(seaColor, landColor, landCover);

    if (owner != 0u) {
      ivec2 entry = ivec2(int(owner % ${String(PALETTE_WIDTH)}u), int(owner / ${String(PALETTE_WIDTH)}u));
      vec4 paletteTexel = texelFetch(palette, entry, 0);
      vec3 ownerColor = paletteTexel.rgb;
      // Allies of the player are flagged in the palette's alpha (setAllies).
      bool allied = paletteTexel.a < 0.75;
      bool pointed = owner == hovered;
      bool mine = owner == highlight;
      bool wide = mine || allied || pointed;
      float ownerLight = luma(ownerColor);
      // Distance to the nearest border in screen pixels: exact close up, from
      // rings of samples when zoomed out, where the vote is off.
      float toBorder = min(min(oe, ownerWide), coastIn) / max(pixel, 1e-4);
      float toFront = min(oe, ownerWide) / max(pixel, 1e-4);
      float ringMix = smoothstep(0.22, 0.5, pixel);
      float ring = ringMix > 0.0 ? 10.0 * (1.0 - clamp(2.0 * ringShare(ato, owner, pixel), 0.0, 1.0)) : 10.0;
      float dpx = mix(toBorder, min(ring, toBorder), ringMix);
      float dFront = mix(toFront, min(ring, toFront + 4.0), ringMix);
      // Pale colours already sit close to white: they get less of every brightening.
      float pale = smoothstep(0.35, 0.75, ownerLight);
      float prox = pow(1.0 - clamp(dpx / (mine ? 12.0 : 14.0), 0.0, 1.0), 1.5);
      // The owner's colour is a translucent tint over the lit land, deeper in
      // the heart, brighter at the rim, a little uneven from patch to patch.
      float vn = nz(at * 0.05 + float(owner) * 5.3) * 0.6 + nz(at * 0.17 + float(owner) * 2.1) * 0.4;
      vec3 glass = ownerColor * mix(vec3(0.9, 1.0, 1.1), vec3(1.1, 1.0, 0.86), vn) * (0.74 + 0.52 * vn) * (0.45 + 0.6 * shade) * mix(1.0, 0.55, pale);
      vec3 fill = mix(albedo * shade * 1.25, glass, mix(0.32, 0.5, zoomedOut) * mix(1.0, 0.75, pale) * (1.0 - 0.22 * hm));
      fill *= 1.0 + 0.2 * detail * fineFade + (fineFade > 0.0 ? 0.07 * (nz(at * 3.3) - 0.5) * fineFade : 0.0) + forest * (canopy - 0.5) * 0.3;
      fill *= mix(0.9, 1.0, prox);
      vec3 rimColor = mix(ownerColor, vec3(1.0), (mine ? 0.5 : 0.18) * (1.0 - 0.7 * pale)) * mix(mine ? 1.35 : 1.18, 1.0, pale);
      fill = mix(fill, rimColor, (mine ? 0.55 : 0.7) * (1.0 - 0.3 * pale) * prox);
      // A faint bevel: the rim catches the north-west light, the south-east one sinks.
      fill *= 1.0 + 0.28 * dot(inward, vec2(0.707, 0.707)) * (1.0 - smoothstep(0.0, 3.5, dpx));
      if (pointed) fill = mix(fill, vec3(1.0), 0.16);
      // The lead line: crisp and dark, wider for the player, their allies and the land under the pointer.
      float width = max(1.25 * pixel, min(0.14, 2.8 * pixel)) * (mine ? 1.15 : (wide ? 1.35 : 1.0));
      vec3 lineColor = mine ? mix(ownerColor, vec3(1.0), 0.85) : ownerColor * mix(0.22, 0.12, smoothstep(0.35, 0.75, ownerLight));
      float border = 1.0 - smoothstep(width - pixel, width, lineOwn);
      // The coast is a finer, colder line; a speck of land or a thin strip keeps its colour.
      float landDepth = coastDistance(textureLod(ground, at / worldSize, lod + 2.0).a);
      float coastLine = (1.0 - smoothstep(0.5 * width - pixel, 0.5 * width, coastIn)) * (1.0 - border) * smoothstep(0.3, 1.6, landDepth);
      float dash = allied ? step(0.5, fract((at.x + at.y) / (16.0 * pixel))) : 1.0;
      vec3 owned = mix(fill, lineColor, border * dash);
      owned = mix(owned, mix(lineColor, vec3(0.03, 0.06, 0.09), 0.7), coastLine * 0.85);
      // A hair of light just inside the dark line, so every country reads as cut glass.
      float inner = (1.0 - smoothstep(0.0, pixel * 1.1, abs(lineOwn - (width + 1.25 * pixel)))) * (1.0 - border);
      owned = mix(owned, mix(rimColor, vec3(1.0), 0.35), inner * 0.4 * dash * (mine ? 0.8 : 0.7) * (1.0 - smoothstep(0.5, 1.2, pixel)));
      // Between two players the line is firmer still.
      float contactWidth = 1.9 * width;
      owned = mix(owned, lineColor * 0.7, (1.0 - smoothstep(contactWidth - pixel, contactWidth, lineContact)) * dash);

      // Fronts: a thin ember line with a soft glow, a darker strip behind it, sparks and smoke.
      float front = 1.0 - smoothstep(fadeSeconds, frontSeconds, age);
      // Blended between tiles close up and, at any zoom, near a front, so its glow has no steps of tiles.
      if (pixel <= 1.0 || dFront < 14.0) {
        vec2 q = at - 0.5;
        ivec2 c = ivec2(floor(q));
        vec2 u = q - vec2(c);
        int x0 = wrapColumn(c.x);
        int x1 = wrapColumn(c.x + 1);
        int y0 = clampRow(c.y);
        int y1 = clampRow(c.y + 1);
        front = mix(mix(frontOf(ivec2(x0, y0)), frontOf(ivec2(x1, y0)), u.x),
          mix(frontOf(ivec2(x0, y1)), frontOf(ivec2(x1, y1)), u.x), u.y);
      }
      if (dFront < 14.0) {
        float reach = max(1.2, 3.0 * pixel);
        vec2 spokes[8] = vec2[8](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0), vec2(0.7, 0.7), vec2(-0.7, 0.7), vec2(0.7, -0.7), vec2(-0.7, -0.7));
        float sum = 0.0;
        for (int k = 0; k < 8; k++) sum += frontOf(wrapTile(ivec2(floor(ato + spokes[k] * reach))));
        front = max(front, min(1.0, sum * 0.3));
      }
      if (front > 0.01) {
        // A front along a coast is mostly sea: keep it quieter there.
        float fa = front * mix(0.3, 1.0, smoothstep(0.8, 3.0, coastIn / max(pixel, 1e-4)));
        owned *= 1.0 - 0.5 * fa * exp(-dFront / 15.0);
        // A bright dashed core marching forward, an ember edge and a short glow; still with less motion.
        float dash = step(0.35, fract((at.x + at.y) / (12.0 * pixel) - now * 2.0 * frontMotion));
        owned += vec3(1.0, 0.32, 0.08) * exp(-dFront / 5.0) * fa * 1.1;
        owned = mix(owned, vec3(1.0, 0.45, 0.15), (1.0 - smoothstep(1.6, 2.3, dFront)) * fa);
        owned = mix(owned, vec3(1.0, 0.97, 0.9), (1.0 - smoothstep(0.5, 1.1, dFront)) * fa * dash);
      }
      // A tile taken a moment ago fades in, so fronts creep instead of jumping each tick.
      color = mix(color, owned, fadeIn * landCover);
    }
  #ifndef SPHERE
    // Vignette, at world zoom only: the map is an object on a dark table.
    vec2 corner = gl_FragCoord.xy / max(viewport, vec2(1.0)) - 0.5;
    color *= 1.0 - 0.42 * smoothstep(0.35, 0.95, length(corner * vec2(1.0, 1.15))) * smoothstep(0.35, 1.0, pixel);
  #endif
  #endif
  #ifdef SPHERE
    if (hit < 0.0) {
      if (!atmosphere(eye, ray, outColor)) discard;
      return;
    }
    // Lit by the sun, darker toward the rim, so the planet reads as round.
    vec3 sun = sunDirection();
    float facing = max(dot(point, -ray), 0.0);
    float daylight = smoothstep(-0.3, 0.8, dot(point, sun));
    color *= mix(0.42, 1.12, daylight) * mix(0.65, 1.0, sqrt(facing));
    // The sun's glint on open water, seen from afar only: up close it would wash out a whole sea.
    float glintCos = max(dot(point, normalize(sun - ray)), 0.0);
    float glint = (pow(glintCos, 600.0) * 0.5 + pow(glintCos, 60.0) * 0.05) * (1.0 - landCover) * smoothstep(0.5, 1.3, pixel);
    color += vec3(1.0, 0.9, 0.75) * glint;
    // The air seen along the ground at a grazing angle scatters blue light back.
    color = mix(color, vec3(0.30, 0.55, 1.0), 0.5 * pow(1.0 - facing, 3.0) * (0.35 + 0.65 * daylight));
  #endif
    outColor = linearToOutputTexel(vec4(color, 1.0));
  }
`;

/** Deepest water band of the map format (maps.md, Relief and depth): more than 4,000 m. */
const ABYSS_BAND = 24;

/**
 * Depth of every tile of water from the map's bands, 0 on the shelf to 255 in
 * the abyss, for the sea's colour; land is 0, so a shore is shelf. All zeros
 * on a map without bathymetry, which then shades its sea by the distance to
 * the coast.
 */
export function seaDepths(
  terrain: Uint8Array,
  relief: Uint8Array | undefined,
  width: number,
  wrapsX: boolean,
): Uint8Array {
  const depths = new Uint8Array(terrain.length);
  if (!relief) return depths;
  let any = false;
  for (let tile = 0; tile < terrain.length; tile++) {
    if (terrain[tile] !== 0) continue;
    const band = relief[tile] as number;
    if (band > 0) {
      depths[tile] = Math.min(255, Math.round((band * 255) / ABYSS_BAND));
      any = true;
    }
  }
  // The bands are steps a tile wide: three passes of a box blur turn them
  // into slopes a few tiles wide, smooth at every zoom.
  if (any) for (let pass = 0; pass < 3; pass++) boxBlur(depths, width, wrapsX, DEPTH_BLUR);
  return depths;
}

/** Radius in tiles of each pass of the depth's blur. */
const DEPTH_BLUR = 2;

/** A box blur of `radius` tiles across rows then down columns, in place; columns wrap if the map does. */
function boxBlur(values: Uint8Array, width: number, wrapsX: boolean, radius: number): void {
  const height = values.length / width;
  const span = 2 * radius + 1;
  const line = new Uint16Array(Math.max(width, height) + 2 * radius);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let i = -radius; i < width + radius; i++) {
      const x = wrapsX ? (i + width) % width : Math.min(width - 1, Math.max(0, i));
      line[i + radius] = values[row + x] as number;
    }
    let sum = 0;
    for (let i = 0; i < span; i++) sum += line[i] as number;
    for (let x = 0; x < width; x++) {
      values[row + x] = Math.round(sum / span);
      sum += (line[x + span] ?? 0) - (line[x] as number);
    }
  }
  for (let x = 0; x < width; x++) {
    for (let i = -radius; i < height + radius; i++) {
      const y = Math.min(height - 1, Math.max(0, i));
      line[i + radius] = values[y * width + x] as number;
    }
    let sum = 0;
    for (let i = 0; i < span; i++) sum += line[i] as number;
    for (let y = 0; y < height; y++) {
      values[y * width + x] = Math.round(sum / span);
      sum += (line[y + span] ?? 0) - (line[y] as number);
    }
  }
}

/**
 * Draws ownership for the whole world in one draw call: owners live in a
 * 16-bit integer texture that aliases the simulation's array, and a shader
 * turns ids into colours and finds borders. Only the parts of rows that
 * changed since the last frame are uploaded again: each row is split into up
 * to 32 chunks, and a chunk is sent if any of its tiles changed. Given the
 * renderer, rows are sent by bands of BAND_ROWS, a rectangle per run of
 * chunks dirty in the band.
 *
 * On a map that wraps, the mesh spans three copies of the world side by
 * side, so a camera kept over the middle copy never sees an edge. A flat map
 * is drawn once.
 */
export class TerritoryLayer {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly ownerTexture: THREE.DataTexture;
  readonly paletteTexture: THREE.DataTexture;
  /** Colour of the ground under each tile, with its coast sides in alpha. */
  readonly groundTexture: THREE.DataTexture;
  /** When each tile last changed hands, in seconds on the layer's clock. */
  readonly takenAtTexture: THREE.DataTexture;
  /** The height the ground is lit from, one byte a tile, filtered smooth (terrain-colors). */
  readonly heightTexture: THREE.DataTexture;
  /** Depth of the sea from the map's bathymetry, filtered like the ground. */
  readonly depthTexture: THREE.DataTexture;
  private readonly hasDepth: boolean;
  private readonly takenAt: Float32Array;
  /** The globe camera's rays, read by the shader on a sphere. */
  private readonly rays = {
    eye: new THREE.Vector3(0, 0, 3),
    rayForward: new THREE.Vector3(0, 0, -1),
    rayRight: new THREE.Vector3(1, 0, 0),
    rayUp: new THREE.Vector3(0, 1, 0),
  };
  private readonly paletteData: Uint8Array;
  private readonly chunkWidth: number;
  private readonly dirtyChunks: Uint32Array;
  private readonly dirtyRows: Int32Array;
  private dirtyRowCount = 0;
  /** Per band of BAND_ROWS rows: its dirty chunks, and its first and last dirty rows. */
  private readonly bandChunks: Uint32Array;
  private readonly bandFirst: Int32Array;
  private readonly bandLast: Int32Array;
  /** Where a rectangle is gathered before it is sent (uploadBands). */
  private sendScratch: { owners: Uint16Array; times: Float32Array } | undefined;
  private readonly wrapsX: boolean;
  /** Ground colours as baked, to put back where fallout clears; made on first use. */
  private pristineGround: Uint8Array | undefined;
  private readonly heightData: Uint8Array;
  /** Tiles drawn under fallout now, and the zones they come from. */
  private scorched: number[] = [];
  private falloutKey = "";
  /** The rectangle of the ground that changed since it was last sent: first and last column and row. */
  private groundDirty: { x0: number; y0: number; x1: number; y1: number } | undefined;
  private fullRefresh = false;

  constructor(readonly options: TerritoryLayerOptions) {
    const { width, height, owners, terrain, maxOwner } = options;
    const wrapsX = options.wrapsX ?? true;
    if (owners.length !== width * height || terrain.length !== width * height) {
      throw new RangeError("owner and terrain arrays must cover the whole map");
    }

    this.ownerTexture = new THREE.DataTexture(
      owners,
      width,
      height,
      THREE.RedIntegerFormat,
      THREE.UnsignedShortType,
    );
    this.ownerTexture.internalFormat = "R16UI";

    const source = options.groundSource;
    const ahead =
      bakedGrounds.get(terrain) ?? (source && takeBakedGround(source.id, source.sha256));
    const heights = ahead?.heights ?? new Uint8Array(width * height);
    const colors =
      ahead?.colors ??
      bakeTerrainColors({
        width,
        height,
        kinds: terrain,
        relief: options.relief ?? new Uint8Array(width * height),
        wrapsX,
        latitudes: options.latitudes,
        heightOut: heights,
      });
    bakedGrounds.set(terrain, { colors, heights });
    this.heightData = heights;
    this.groundTexture = new THREE.DataTexture(colors, width, height);
    this.heightTexture = new THREE.DataTexture(
      heights,
      width,
      height,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.wrapsX = wrapsX;
    const depths = seaDepths(terrain, options.relief, width, wrapsX);
    this.hasDepth = depths.some((value) => value > 0);
    this.depthTexture = new THREE.DataTexture(
      this.hasDepth ? depths : new Uint8Array(1),
      this.hasDepth ? width : 1,
      this.hasDepth ? height : 1,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );

    // Long ago: nothing fades on the first frame.
    this.takenAt = new Float32Array(width * height).fill(-1e6);
    this.takenAtTexture = new THREE.DataTexture(
      this.takenAt,
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.takenAtTexture.internalFormat = "R32F";

    const rows = Math.ceil((maxOwner + 1) / PALETTE_WIDTH);
    this.paletteData = new Uint8Array(PALETTE_WIDTH * rows * 4);
    this.paletteTexture = new THREE.DataTexture(this.paletteData, PALETTE_WIDTH, rows);
    this.paletteTexture.colorSpace = THREE.SRGBColorSpace;

    for (const texture of [
      this.ownerTexture,
      this.groundTexture,
      this.heightTexture,
      this.depthTexture,
      this.takenAtTexture,
      this.paletteTexture,
    ]) {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // Rows of 8- and 16-bit texels are not 4-byte aligned on every map width.
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
    }
    // The ground and its height are filtered: smooth between tile centres, and
    // averaged over the tiles under a pixel when zoomed out.
    if (!options.flat) {
      for (const texture of [this.groundTexture, this.heightTexture, this.depthTexture]) {
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        texture.wrapS = wrapsX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      }
    }

    const sphere = options.surface === "sphere";
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: { ...(sphere ? { SPHERE: 1 } : {}), ...(options.flat ? { FLAT: 1 } : {}) },
      vertexShader,
      fragmentShader,
      uniforms: {
        owners: { value: this.ownerTexture },
        ground: { value: this.groundTexture },
        heightMap: { value: this.heightTexture },
        depthMap: { value: this.depthTexture },
        hasDepth: { value: this.hasDepth },
        viewport: { value: new THREE.Vector2(1, 1) },
        takenAt: { value: this.takenAtTexture },
        palette: { value: this.paletteTexture },
        worldSize: { value: new THREE.Vector2(width, height) },
        wrapsX: { value: wrapsX },
        now: { value: 0 },
        fadeSeconds: { value: FADE_SECONDS },
        frontSeconds: { value: FRONT_SECONDS },
        frontMotion: { value: 1 },
        foamColor: { value: new THREE.Color(TERRAIN_COLORS.foam) },
        frontColor: { value: new THREE.Color(FRONT_COLOR) },
        seaShallow: { value: new THREE.Color(TERRAIN_COLORS.seaShallow) },
        seaOpen: { value: new THREE.Color(MAP_COLORS.ocean) },
        seaDeep: { value: new THREE.Color(MAP_COLORS.oceanDeep) },
        coastReach: { value: COAST_REACH },
        reliefShading: { value: 1 },
        groundLevel: { value: GROUND_LEVEL },
        highlight: { value: 0 },
        hovered: { value: 0 },
        eye: { value: this.rays.eye },
        rayForward: { value: this.rays.rayForward },
        rayRight: { value: this.rays.rayRight },
        rayUp: { value: this.rays.rayUp },
      },
      // The globe's quad covers the whole screen and must not hide what is drawn over it.
      depthWrite: !sphere,
    });
    const geometry = sphere
      ? new THREE.PlaneGeometry(2, 2)
      : new THREE.PlaneGeometry(wrapsX ? width * 3 : width, height);
    // Local coordinates: x in [-width, 2 * width) or, on a flat map, [0, width); y in [0, height).
    if (!sphere) geometry.translate(width / 2, height / 2, 0);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;

    this.chunkWidth = Math.max(MIN_CHUNK_WIDTH, Math.ceil(width / CHUNKS_PER_ROW));
    this.dirtyChunks = new Uint32Array(height);
    this.dirtyRows = new Int32Array(height);
    const bands = Math.ceil(height / BAND_ROWS);
    this.bandChunks = new Uint32Array(bands);
    this.bandFirst = new Int32Array(bands);
    this.bandLast = new Int32Array(bands);
  }

  setOwnerColor(owner: number, color: THREE.ColorRepresentation): void {
    if (!Number.isInteger(owner) || owner < 1 || owner > this.options.maxOwner) {
      throw new RangeError(`owner ${String(owner)} has no palette entry`);
    }
    const rgb = new THREE.Color(color).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    this.paletteData.set(
      [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)],
      owner * 4,
    );
    // The alpha holds the ally flag: a new colour keeps it.
    this.paletteData[owner * 4 + 3] ||= 255;
    this.paletteTexture.needsUpdate = true;
  }

  /** Owners whose land gets a dashed wide rim: the allies of the player at this screen. */
  setAllies(allies: readonly number[]): void {
    const flagged = new Set(allies);
    for (let owner = 1; owner <= this.options.maxOwner; owner++) {
      this.paletteData[owner * 4 + 3] = flagged.has(owner) ? 128 : 255;
    }
    this.paletteTexture.needsUpdate = true;
  }

  /**
   * Discs of land under fallout (R-UNIT-06), drawn as scorched ground:
   * unowned, and a sickly olive rather than its own colour. Zones change
   * only when a heavy missile strikes or its fallout clears, so the ground
   * texture is sent again only then. Returns whether anything changed.
   */
  setFallout(zones: readonly { x: number; y: number; radius: number }[]): boolean {
    const key = zones.map((z) => `${String(z.x)},${String(z.y)},${String(z.radius)}`).join(";");
    if (key === this.falloutKey) return false;
    this.falloutKey = key;
    const { width, height, terrain } = this.options;
    const data = this.groundTexture.image.data as Uint8Array;
    if (!this.pristineGround) {
      this.pristineGround = data.slice();
      // A layer made later for this map starts from the clean ground, not from this scorched one.
      bakedGrounds.set(terrain, { colors: this.pristineGround, heights: this.heightData });
    }
    const pristine = this.pristineGround;
    let wrapped = false;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    const touch = (column: number, row: number): void => {
      if (column < x0) x0 = column;
      if (column > x1) x1 = column;
      if (row < y0) y0 = row;
      if (row > y1) y1 = row;
    };
    for (const tile of this.scorched) {
      for (let c = 0; c < 3; c++) data[tile * 4 + c] = pristine[tile * 4 + c] as number;
      const column = tile % width;
      touch(column, (tile - column) / width);
    }
    this.scorched = [];
    for (const { x, y, radius } of zones) {
      for (let dy = -radius; dy <= radius; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          let column = x + dx;
          if (this.wrapsX) {
            const inside = ((column % width) + width) % width;
            if (inside !== column) wrapped = true;
            column = inside;
          } else if (column < 0 || column >= width) continue;
          const tile = row * width + column;
          if (terrain[tile] === 0) continue;
          this.scorched.push(tile);
          touch(column, row);
          for (let c = 0; c < 3; c++) {
            const base = pristine[tile * 4 + c] as number;
            data[tile * 4 + c] = Math.round(base * 0.35 + (FALLOUT[c] as number) * 0.65);
          }
        }
      }
    }
    // Only the rectangle that changed goes to the GPU (flush), unless a disc
    // wraps around the map's edge: then it is the whole ground.
    if (wrapped) this.groundTexture.needsUpdate = true;
    else if (x1 >= 0) {
      const dirty = this.groundDirty;
      this.groundDirty = dirty
        ? {
            x0: Math.min(dirty.x0, x0),
            y0: Math.min(dirty.y0, y0),
            x1: Math.max(dirty.x1, x1),
            y1: Math.max(dirty.y1, y1),
          }
        : { x0, y0, x1, y1 };
    }
    return true;
  }

  /** The owner whose land gets the wide rim, usually the player at this screen; 0 for none. */
  setHighlight(owner: number): void {
    const highlight = this.mesh.material.uniforms.highlight;
    if (highlight) highlight.value = owner;
  }

  /** The owner whose land is under the pointer, lit whole; 0 for none. */
  setHovered(owner: number): void {
    const hovered = this.mesh.material.uniforms.hovered;
    if (hovered) hovered.value = owner;
  }

  /** Size of the drawing buffer in pixels, for effects laid on the screen; set before each draw. */
  setViewport(width: number, height: number): void {
    const viewport = this.mesh.material.uniforms.viewport;
    if (viewport) (viewport.value as THREE.Vector2).set(width, height);
  }

  /** Whether the glint runs along attack fronts; off for players who ask for less motion. */
  setMotion(moving: boolean): void {
    const motion = this.mesh.material.uniforms.frontMotion;
    if (motion) motion.value = moving ? 1 : 0;
  }

  /** Points the rays of a globe at the planet; set once per frame. Ignored on a plane. */
  setGlobePose(rays: GlobeRays): void {
    const { eye, rayForward, rayRight, rayUp } = this.rays;
    eye.set(...rays.position);
    rayForward.set(...rays.forward);
    rayRight.set(...rays.right);
    rayUp.set(...rays.up);
  }

  /** Seconds on the clock that fades new tiles in; set once per frame. */
  setTime(seconds: number): void {
    const now = this.mesh.material.uniforms.now;
    if (now) now.value = seconds;
  }

  /**
   * Marks tiles whose owner changed in the shared array. With a time, they
   * fade in from that moment on; without one, they appear at once.
   */
  markChanged(tiles: ArrayLike<number>, seconds?: number): void {
    const { width } = this.options;
    const { chunkWidth, dirtyChunks } = this;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i] as number;
      if (seconds !== undefined) this.takenAt[tile] = seconds;
      const x = tile % width;
      const y = (tile - x) / width;
      const mask = dirtyChunks[y] as number;
      if (mask === 0) this.dirtyRows[this.dirtyRowCount++] = y;
      dirtyChunks[y] = mask | (1 << Math.floor(x / chunkWidth));
    }
  }

  /** Too many changes to track: upload the whole texture on the next frame. */
  markAllChanged(): void {
    this.fullRefresh = true;
  }

  /**
   * Turns pending changes into texture uploads. Call once per frame before
   * rendering; returns the number of texels sent to the GPU. With the
   * renderer that draws the layer, changes go straight to the GPU by bands of
   * rows; without it, three.js sends them on the next render, a call per row.
   */
  flush(renderer?: THREE.WebGLRenderer): number {
    const { width, height } = this.options;
    const textures = [this.ownerTexture, this.takenAtTexture];
    let texels = 0;
    if (this.fullRefresh) {
      for (const texture of textures) {
        texture.clearUpdateRanges();
        texture.needsUpdate = true;
      }
      texels = width * height;
    } else if (this.dirtyRowCount > 0 && renderer && this.uploaded(renderer)) {
      texels = this.uploadBands(renderer);
    } else if (this.dirtyRowCount > 0) {
      for (let i = 0; i < this.dirtyRowCount; i++) {
        texels += this.queueRow(this.dirtyRows[i] as number);
      }
      for (const texture of textures) texture.needsUpdate = true;
    }
    for (let i = 0; i < this.dirtyRowCount; i++) this.dirtyChunks[this.dirtyRows[i] as number] = 0;
    this.dirtyRowCount = 0;
    this.fullRefresh = false;
    if (this.groundDirty) this.sendGround(renderer, this.groundDirty);
    this.groundDirty = undefined;
    return texels;
  }

  /**
   * Sends the rectangle of the ground that fallout changed. A fallout zone is
   * a disc of a few dozen tiles on a map of millions: sending the whole ground
   * (32 MiB on the largest map) for each strike or end of fallout is a hitch
   * of tens of milliseconds, and more on a phone. The mipmaps are rebuilt on
   * the GPU. Without the renderer, or before the ground is on the GPU, three.js
   * sends everything on the next render.
   */
  private sendGround(
    renderer: THREE.WebGLRenderer | undefined,
    { x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const texture = this.groundTexture;
    const state = renderer?.properties.get(texture) as
      { __webglTexture?: WebGLTexture; __version?: number } | undefined;
    if (!renderer || !state?.__webglTexture || state.__version !== texture.version) {
      texture.needsUpdate = true;
      return;
    }
    const { width } = this.options;
    const columns = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    const data = texture.image.data as Uint8Array;
    const out = new Uint8Array(columns * rows * 4);
    for (let row = 0; row < rows; row++) {
      const from = ((y0 + row) * width + x0) * 4;
      out.set(data.subarray(from, from + columns * 4), row * columns * 4);
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    renderer.state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    renderer.state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    renderer.state.bindTexture(gl.TEXTURE_2D, state.__webglTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, columns, rows, gl.RGBA, gl.UNSIGNED_BYTE, out);
    if (texture.generateMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** Whether both textures are on the GPU as they stand, with no upload of three.js pending. */
  private uploaded(renderer: THREE.WebGLRenderer): boolean {
    return [this.ownerTexture, this.takenAtTexture].every((texture) => {
      const state = renderer.properties.get(texture) as {
        __webglTexture?: WebGLTexture;
        __version?: number;
      };
      return state.__webglTexture !== undefined && state.__version === texture.version;
    });
  }

  /** Sends the dirty chunks of each band of rows as one rectangle per texture; returns the texels sent. */
  private uploadBands(renderer: THREE.WebGLRenderer): number {
    const { width } = this.options;
    const { bandChunks, bandFirst, bandLast, chunkWidth } = this;
    const dirtyBands: number[] = [];
    for (let i = 0; i < this.dirtyRowCount; i++) {
      const y = this.dirtyRows[i] as number;
      const band = Math.floor(y / BAND_ROWS);
      if (bandChunks[band] === 0) {
        dirtyBands.push(band);
        bandFirst[band] = y;
        bandLast[band] = y;
      }
      bandChunks[band] = (bandChunks[band] as number) | (this.dirtyChunks[y] as number);
      bandFirst[band] = Math.min(bandFirst[band] as number, y);
      bandLast[band] = Math.max(bandLast[band] as number, y);
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const { state, properties } = renderer;
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Each rectangle is copied into a small buffer of its own and sent from it, with
    // no row length or offsets to the driver: some (Safari's) go through the whole
    // source array, tens of milliseconds a frame on a large map, when they are used.
    const owners = this.ownerTexture.image.data as Uint16Array;
    const times = this.takenAtTexture.image.data as Float32Array;
    this.sendScratch ??= {
      owners: new Uint16Array(width * BAND_ROWS),
      times: new Float32Array(width * BAND_ROWS),
    };
    const { owners: ownersOut, times: timesOut } = this.sendScratch;
    const sends = [
      { texture: this.ownerTexture, format: gl.RED_INTEGER, type: gl.UNSIGNED_SHORT },
      { texture: this.takenAtTexture, format: gl.RED, type: gl.FLOAT },
    ];
    let texels = 0;
    for (const band of dirtyBands) {
      const mask = bandChunks[band] as number;
      bandChunks[band] = 0;
      const y = bandFirst[band] as number;
      const rows = (bandLast[band] as number) - y + 1;
      // One rectangle per run of chunks dirty in any row of the band.
      let chunk = 0;
      while (chunk < CHUNKS_PER_ROW) {
        if (((mask >>> chunk) & 1) === 0) {
          chunk++;
          continue;
        }
        const first = chunk;
        while (chunk < CHUNKS_PER_ROW && ((mask >>> chunk) & 1) === 1) chunk++;
        const x = first * chunkWidth;
        const columns = Math.min(width, chunk * chunkWidth) - x;
        for (let row = 0; row < rows; row++) {
          const from = (y + row) * width + x;
          ownersOut.set(owners.subarray(from, from + columns), row * columns);
          timesOut.set(times.subarray(from, from + columns), row * columns);
        }
        const count = columns * rows;
        for (const { texture, format, type } of sends) {
          const { __webglTexture } = properties.get(texture) as { __webglTexture: WebGLTexture };
          state.bindTexture(gl.TEXTURE_2D, __webglTexture);
          const data =
            texture === this.ownerTexture
              ? ownersOut.subarray(0, count)
              : timesOut.subarray(0, count);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, columns, rows, format, type, data);
        }
        texels += count;
      }
    }
    return texels;
  }

  /** Queues one update range per run of dirty chunks in a row; returns its texels. */
  private queueRow(y: number): number {
    const { width } = this.options;
    const mask = this.dirtyChunks[y] as number;
    let texels = 0;
    let chunk = 0;
    while (chunk < CHUNKS_PER_ROW) {
      if (((mask >>> chunk) & 1) === 0) {
        chunk++;
        continue;
      }
      const first = chunk;
      while (chunk < CHUNKS_PER_ROW && ((mask >>> chunk) & 1) === 1) chunk++;
      const from = first * this.chunkWidth;
      const count = Math.min(width, chunk * this.chunkWidth) - from;
      // three.js measures update ranges in RGBA components whatever the
      // format, hence the factor 4 for a single-channel texture.
      this.ownerTexture.addUpdateRange((y * width + from) * 4, count * 4);
      this.takenAtTexture.addUpdateRange((y * width + from) * 4, count * 4);
      texels += count;
    }
    return texels;
  }

  /** Bytes the layer's textures take on the GPU. */
  gpuBytes(): number {
    const { width, height } = this.options;
    // Owners, ground colours with their mipmaps (a third more), and the time each tile changed hands.
    const ground = this.options.flat ? 4 : (4 * 4) / 3;
    return Math.round(width * height * (2 + ground + 4)) + this.paletteData.byteLength;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.ownerTexture.dispose();
    this.groundTexture.dispose();
    this.heightTexture.dispose();
    this.depthTexture.dispose();
    this.takenAtTexture.dispose();
    this.paletteTexture.dispose();
  }
}

function luminance(hex: string): number {
  const { r, g, b } = new THREE.Color(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
