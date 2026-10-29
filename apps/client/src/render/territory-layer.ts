import * as THREE from "three";
import { MAP_COLORS } from "../palette.ts";
import { FRONT_SECONDS } from "./fronts.ts";
import {
  COAST_REACH,
  TERRAIN_COLORS,
  bakeTerrainColors,
  type Latitudes,
} from "./terrain-colors.ts";

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
const FADE_SECONDS = 0.15;

/** Ground under fallout (R-UNIT-06): a scorched olive, mixed into the land's own colour. */
const FALLOUT = [96, 102, 34] as const;

/** Luminance of lowland ground: the relief lightens owned land above it and darkens it below. */
const GROUND_LEVEL = luminance(MAP_COLORS.land);

const PALETTE_WIDTH = 256;

/**
 * Reach of a tile's vote on who owns the points around it, in tiles: wide
 * enough that borders round off over a tile and a half; and a stronger
 * vote close to the tile's centre, so a lone tile, which its neighbours
 * would outvote, keeps a patch of its own.
 */
const KERNEL = 1.5;
const CORE = 0.8;

/** Each row is tracked as at most 32 column chunks, one bit each. */
const CHUNKS_PER_ROW = 32;
const MIN_CHUNK_WIDTH = 64;

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

  ivec2 wrapTile(ivec2 tile) {
    ivec2 size = ivec2(worldSize);
    int x = wrapsX ? (tile.x % size.x + size.x) % size.x : clamp(tile.x, 0, size.x - 1);
    return ivec2(x, clamp(tile.y, 0, size.y - 1));
  }

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

  /** How bright a tile's front is: 1 when just taken, 0 once it has burnt out. */
  float frontOf(ivec2 tile) {
    float age = now - texelFetch(takenAt, wrapTile(tile), 0).r;
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
    uint owner;
    ivec2 tile = wrapTile(ivec2(floor(at)));
    float ownerEdge = 2.0;
    float contactEdge = 2.0;
    if (pixel > 1.0) {
      // Zoomed out, a tile is under a pixel and curves would not show: each
      // tile takes its own owner and borders follow its edges, as on the flat map.
      owner = ownerAt(tile);
      uvec4 around = uvec4(ownerAt(tile + ivec2(1, 0)), ownerAt(tile - ivec2(1, 0)),
        ownerAt(tile + ivec2(0, 1)), ownerAt(tile - ivec2(0, 1)));
      bvec4 other = notEqual(around, uvec4(owner));
      bvec4 touch = bvec4(vec4(other) * vec4(greaterThan(around, uvec4(0u))));
      ownerEdge = edgeDistance(fract(at), other);
      contactEdge = edgeDistance(fract(at), touch);
    } else {
      vec2 p = at - 0.5;
      ivec2 base = ivec2(floor(p)) - 1;
      // Most of the map lies inside one owner's land, or nobody's: when the
      // sixteen tiles agree, the votes are skipped.
      uint around[16];
      bool same = true;
      for (int k = 0; k < 16; k++) {
        around[k] = texelFetch(owners, wrapTile(base + ivec2(k % 4, k / 4)), 0).r;
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
          vec2 offset = at - (vec2(cell) + 0.5);
          float d2 = dot(offset, offset);
          float wide = max(0.0, 1.0 - d2 / ${String(KERNEL * KERNEL)});
          float near = max(0.0, 1.0 - d2 / ${String(CORE * CORE)});
          float w = wide * wide + 0.5 * near * near;
          if (w <= 0.0) continue;
          ivec2 wrapped = wrapTile(cell);
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

    // The ground, filtered between tile centres so hills and coasts are smooth.
    // Its level of detail follows the zoom, given rather than derived, because
    // the globe's columns jump at the antimeridian.
    vec4 groundSample = textureLod(ground, at / worldSize, max(0.0, log2(pixel)));
    float coast = coastDistance(groundSample.a);
    float coastPixels = coast / max(fwidth(coast), 1e-4);
    // Land above the coast, with an edge one pixel soft.
    float landCover = clamp(coastPixels + 0.5, 0.0, 1.0);
    // Close up, a fine mottling, finer than a tile, keeps the ground from
    // looking blurred; it fades out before it could shimmer.
    float detail = 0.0;
    if (pixel < 0.5) detail = (noise(at * 1.7) * 0.6 + noise(at * 4.1) * 0.4 - 0.5) * (1.0 - smoothstep(0.15, 0.5, pixel));
    // Closer still, a finer grain, so a tile filling the screen is not a smear.
    if (pixel < 0.12) detail += (noise(at * 11.0) - 0.5) * 0.6 * (1.0 - smoothstep(0.04, 0.12, pixel));
  #endif
  #ifdef SPHERE
    // Pixels clear of the rim stop here, once every derivative is taken: after
    // a discard, derivatives are undefined on some GPUs. Those next to it go
    // on, so the rim keeps its derivatives.
    if (hit < -rim) discard;
  #endif

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
    // could shimmer.
    float swellFade = 1.0 - smoothstep(0.2, 0.6, pixel);
    if (swellFade > 0.0) {
      float t = now * frontMotion;
      float swell = noise(at * 0.45 + t * vec2(0.09, 0.04)) + noise(at * 0.9 - t * vec2(0.05, 0.08)) - 1.0;
      sea *= 1.0 + 0.12 * swell * swellFade * (1.0 - shallows);
    }
    float foamWidth = max(0.12, 1.1 * pixel);
    float foam = 1.0 - smoothstep(0.5 * foamWidth, foamWidth, depth);
    sea = mix(sea, foamColor, foam * 0.6);
    // The shore is a tone lighter, so coasts read at any zoom.
    vec3 land = groundSample.rgb * (1.0 + 0.16 * detail) * (1.0 + 0.18 * (1.0 - smoothstep(0.0, max(0.35, 2.0 * pixel), max(coast, 0.0))));
    vec3 color = mix(sea, land, landCover);

    // Distance in tiles to the edge of the owner's land: another owner's, or the sea.
  #ifdef FLAT
    float edge = ownerEdge;
  #else
    float edge = min(ownerEdge, max(coast, 0.0));
  #endif

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
      float contact = 1.0 - smoothstep(contactWidth - pixel, contactWidth, contactEdge);
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
      owned = mix(owned, mix(lineColor * 0.5, ridgeColor, smoothstep(0.4 * contactWidth, 0.5 * contactWidth, contactEdge)), contact * dash);
      float age = now - texelFetch(takenAt, tile, 0).r;
      // Land taken in the last moments marks the front of an attack, the
      // strongest signal on the map: its edge turns to ember and light stripes
      // that march along it, readable on any colour and without colour, and
      // the strip behind it glows ember and pulses (steady with less motion).
      // Zoomed out, where a tile is under a pixel and edges vanish, the strip
      // takes the stripes instead.
    #ifdef FLAT
      float front = 1.0 - smoothstep(fadeSeconds, frontSeconds, age);
    #else
      // Blended between tile centres, so the burning strip has no steps and
      // fades from the newest land, at the front, to the oldest behind it.
      // Zoomed out, where a tile is under a pixel, the tile's own will do.
      float front = 1.0 - smoothstep(fadeSeconds, frontSeconds, age);
      if (pixel <= 1.0) {
        vec2 q = at - 0.5;
        ivec2 c = ivec2(floor(q));
        vec2 u = q - vec2(c);
        front = mix(mix(frontOf(c), frontOf(c + ivec2(1, 0)), u.x),
          mix(frontOf(c + ivec2(0, 1)), frontOf(c + ivec2(1, 1)), u.x), u.y);
      }
    #endif
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
  #ifdef SPHERE
    if (hit < 0.0) discard;
    // Darker toward the rim, so the planet reads as round.
    color *= mix(0.45, 1.0, sqrt(max(dot(point, -ray), 0.0)));
  #endif
    outColor = linearToOutputTexel(vec4(color, 1.0));
  }
`;

/**
 * Draws ownership for the whole world in one draw call: owners live in a
 * 16-bit integer texture that aliases the simulation's array, and a shader
 * turns ids into colours and finds borders. Only the parts of rows that
 * changed since the last frame are uploaded again: each row is split into up
 * to 32 chunks, and a chunk is sent if any of its tiles changed.
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
  private readonly wrapsX: boolean;
  /** Ground colours as baked, to put back where fallout clears; made on first use. */
  private pristineGround: Uint8Array | undefined;
  /** Tiles drawn under fallout now, and the zones they come from. */
  private scorched: number[] = [];
  private falloutKey = "";
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

    this.groundTexture = new THREE.DataTexture(
      bakeTerrainColors({
        width,
        height,
        kinds: terrain,
        relief: options.relief ?? new Uint8Array(width * height),
        wrapsX,
        latitudes: options.latitudes,
      }),
      width,
      height,
    );
    this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.wrapsX = wrapsX;

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
    // The ground alone is filtered: smooth between tile centres, and averaged
    // over the tiles under a pixel when zoomed out.
    if (!options.flat) {
      this.groundTexture.magFilter = THREE.LinearFilter;
      this.groundTexture.minFilter = THREE.LinearMipmapLinearFilter;
      this.groundTexture.generateMipmaps = true;
      this.groundTexture.wrapS = wrapsX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
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
    this.pristineGround ??= data.slice();
    const pristine = this.pristineGround;
    for (const tile of this.scorched) {
      for (let c = 0; c < 3; c++) data[tile * 4 + c] = pristine[tile * 4 + c] as number;
    }
    this.scorched = [];
    for (const { x, y, radius } of zones) {
      for (let dy = -radius; dy <= radius; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          let column = x + dx;
          if (this.wrapsX) column = ((column % width) + width) % width;
          else if (column < 0 || column >= width) continue;
          const tile = row * width + column;
          if (terrain[tile] === 0) continue;
          this.scorched.push(tile);
          for (let c = 0; c < 3; c++) {
            const base = pristine[tile * 4 + c] as number;
            data[tile * 4 + c] = Math.round(base * 0.35 + (FALLOUT[c] as number) * 0.65);
          }
        }
      }
    }
    this.groundTexture.needsUpdate = true;
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
   * rendering; returns the number of texels sent to the GPU.
   */
  flush(): number {
    const { width, height } = this.options;
    const textures = [this.ownerTexture, this.takenAtTexture];
    let texels = 0;
    if (this.fullRefresh) {
      for (const texture of textures) {
        texture.clearUpdateRanges();
        texture.needsUpdate = true;
      }
      texels = width * height;
    } else if (this.dirtyRowCount > 0) {
      for (let i = 0; i < this.dirtyRowCount; i++) {
        texels += this.queueRow(this.dirtyRows[i] as number);
      }
      for (const texture of textures) texture.needsUpdate = true;
    }
    for (let i = 0; i < this.dirtyRowCount; i++) this.dirtyChunks[this.dirtyRows[i] as number] = 0;
    this.dirtyRowCount = 0;
    this.fullRefresh = false;
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
    this.takenAtTexture.dispose();
    this.paletteTexture.dispose();
  }
}

function luminance(hex: string): number {
  const { r, g, b } = new THREE.Color(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
