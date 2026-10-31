import * as THREE from "three";

/**
 * Ships seen from above, painted in the shader (docs/art-direction.md, Ships):
 * one instanced quad per ship, with the hull, its shadow, its bow wave and a
 * wake that stays on the water behind it all computed per pixel. No bitmap.
 * Kept out of the first visit with the other map layers (lazy.ts).
 */

export type ShipKind = "trade" | "transport" | "warship";

const KIND_ID: Record<ShipKind, number> = { trade: 0, transport: 1, warship: 2 };

/**
 * Length of each hull in tiles, and its smallest length on screen in CSS
 * pixels: a hull never shrinks below a readable boat, and the type is read
 * from the silhouette (a long pointed hull, a blunt barge, a slim cruiser).
 * The vertex shader holds the same figures.
 */
export const HULL_SIZES = {
  trade: { tiles: 1.6, minPixels: 21 },
  transport: { tiles: 2.5, minPixels: 27 },
  warship: { tiles: 3.5, minPixels: 42 },
} as const;

/** On a phone the floor is a little larger, and so is everything the finger has to find. */
const PHONE_FACTOR = 1.12;
/** Between these lengths on screen, in CSS pixels, a hull passes from the far silhouette to the full painting. */
const DETAIL_FROM = 30;
const DETAIL_TO = 84;
/** A ship that moves this fast, in tiles per second, leaves its full wake. */
const FULL_SPEED = 8;

export interface ShipLayerOptions {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly wrapsX?: boolean;
  /** Most hulls drawn at once; the buffers are sized for it up front. */
  readonly capacity: number;
  /** TileKind of every tile, 0 for water: the wake stops at the shore. */
  readonly kinds: Uint8Array;
  /** The light picture of the Saver profile: no relief on the hull, no shadow, no foam noise. */
  readonly flat?: boolean;
  /** A phone, which asks for larger hulls. */
  readonly phone?: boolean;
}

/** One ship to draw, y counted from the north. */
export interface Hull {
  readonly kind: ShipKind;
  readonly x: number;
  readonly y: number;
  /** Radians, 0 east, a quarter turn south. */
  readonly heading: number;
  /** Tiles per second. */
  readonly speed: number;
  readonly color: string;
  /** A warship that has just fired, from 1 on the shot to 0 as the sign of it fades; 0 for the rest. */
  readonly flash?: number;
  /** Tells two hulls apart, for the little differences of their cargo. */
  readonly seed: number;
}

const vertexShader = /* glsl */ `
in vec2 iPos; in float iAng; in vec4 iKind; in vec3 iCol;
uniform float worldWidth; uniform float worldHeight; uniform float cameraX; uniform bool wrapsX;
uniform float tilesPerPixel; uniform float phone; uniform vec2 detail;
out vec2 vLoc; out vec2 vWorld; flat out float vL; flat out float vKind; flat out vec3 vCol; flat out vec2 vSt; flat out float vAng; flat out float vDet; flat out float vFlash;
void main() {
  float kind = iKind.x;
  vec2 hull = kind < 0.5 ? vec2(1.6, 21.0) : (kind < 1.5 ? vec2(2.5, 27.0) : vec2(3.5, 42.0));
  float L = max(hull.x, hull.y * phone * tilesPerPixel);
  // A tight quad: the wake to two lengths behind, the bow wave a little ahead.
  vec2 loc = vec2(mix(-2.0, 0.8, position.x + 0.5), mix(-0.85, 0.85, position.y + 0.5));
  float c = cos(iAng), s = sin(iAng);
  vec2 centre = iPos + 0.5;
  vec4 at = modelMatrix * vec4(centre.x, worldHeight - centre.y, 0.0, 1.0);
  // The copy of the world nearest the camera, judged by the centre so that no hull is torn at the seam.
  float shift = wrapsX ? worldWidth * floor((cameraX - at.x) / worldWidth + 0.5) : 0.0;
  vec2 w = centre + vec2(c * loc.x - s * loc.y, s * loc.x + c * loc.y) * L;
  vLoc = loc; vWorld = w; vL = L; vKind = kind; vCol = iCol; vSt = iKind.zw; vAng = iAng; vFlash = iKind.y;
  vDet = smoothstep(detail.x, detail.y, L / tilesPerPixel);
  vec4 world = modelMatrix * vec4(w.x, worldHeight - w.y, 0.2, 1.0);
  world.x += shift;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
in vec2 vLoc; in vec2 vWorld; flat in float vL; flat in float vKind; flat in vec3 vCol; flat in vec2 vSt; flat in float vAng; flat in float vDet; flat in float vFlash;
uniform float time; uniform float reduced; uniform vec2 light; uniform float tilesPerPixel;
uniform sampler2D land; uniform vec2 worldSize;
layout(location = 0) out highp vec4 outColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
#ifdef FLAT
  return vn(p);
#else
  return vn(p) * 0.62 + vn(p * 2.13 + 7.3) * 0.38;
#endif
}
float sdBox(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// Half beam, where the bow starts, how it curves, how wide the stern is: trade, transport, warship.
vec4 hullP(float k) {
  if (k < 0.5) return vec4(0.118, 0.80, 1.75, 0.92);
  if (k < 1.5) return vec4(0.150, 0.66, 3.2, 0.88);
  return vec4(0.074, 0.50, 1.45, 0.62);
}
float hullW(float t, vec4 hp) {
  float stern = mix(hp.w, 1.0, smoothstep(0.0, 0.22, t));
  float b = clamp((t - hp.y) / (1.0 - hp.y), 0.0, 1.0);
  return hp.x * stern * (1.0 - pow(b, hp.z));
}
float hullD(vec2 p, vec4 hp) {
  float t = p.x + 0.5, tc = clamp(t, 0.0, 1.0);
  float hw = hullW(tc, hp), e = 0.012;
  float sl = (hullW(min(tc + e, 1.0), hp) - hullW(max(tc - e, 0.0), hp)) / (2.0 * e);
  float d = (hw - abs(p.y)) / sqrt(1.0 + sl * sl);
  return min(d, min(t, (1.0 - t) * 0.8));
}

vec3 PC; float PA;
void lay(vec3 c, float a) { a = clamp(a, 0.0, 1.0); PC = PC * (1.0 - a) + c * a; PA = PA * (1.0 - a) + a; }

void main() {
  float L = vL, aa = tilesPerPixel / L, det = vDet;
  float speed = vSt.x, seed = vSt.y;
  vec3 own = vCol;
  vec4 hp = hullP(vKind);
  // Far away the hull is fatter, so that its colour reads, and its bow a clean arrowhead.
  // The beam on screen tells the types apart as the length does: a slim warship, a stout trade ship.
  float farBeam = vKind > 1.5 ? 9.0 : (vKind > 0.5 ? 10.0 : 12.5);
  float boost = mix(max(1.0, farBeam * tilesPerPixel / (2.0 * hp.x * L)), 1.0, det);
  hp.x *= boost;
  hp.z = mix(1.25, hp.z, det);
  hp.w = mix(1.0, hp.w, det);
  PC = vec3(0.0); PA = 0.0;
  vec2 p = vLoc;
  float t = p.x + 0.5;
  vec2 wp = vWorld / L;
  float drift = reduced > 0.5 ? 0.0 : time * 0.07;
  vec2 lightL = vec2(dot(light, vec2(cos(vAng), sin(vAng))), dot(light, vec2(-sin(vAng), cos(vAng))));
  float W = hp.x;

  // Wake: two arms of foam that widen and fade, a churned core, all fixed to the sea so the foam stays where it formed.
  float s = -0.5 - p.x;
  float wk = 0.0;
  if (speed > 0.02 && s > -0.06 && s < 1.9 && abs(p.y) < W * 0.85 + 0.39 * s + 0.09) {
    float edge = W * 0.85 + 0.34 * s;
    float a = abs(abs(p.y) - edge);
    float armW = max(0.014 + 0.050 * s, 1.6 * aa);
    float arm = 1.0 - smoothstep(0.0, armW, a);
    float n = fbm(wp * 15.0 + vec2(drift, -drift));
    arm *= smoothstep(0.10, 0.45, n + 0.12 * sin(s * 30.0 + seed * 6.0));
    float fade = exp(-s * 2.6) * smoothstep(-0.06, 0.05, s) * (1.0 - smoothstep(0.9, 1.5, s));
    float cw = W * 0.75 * (1.0 + 0.45 * s);
    float core = (1.0 - smoothstep(0.0, cw, abs(p.y))) * exp(-s * 2.0) * (1.0 - smoothstep(1.0, 1.9, s));
    core *= smoothstep(0.18, 0.5, vn(wp * 21.0 + 3.0 + vec2(drift)) + 0.28);
    float fill = (1.0 - smoothstep(edge * 0.2, edge, abs(p.y))) * exp(-s * 2.8) * 0.34 * n;
    wk = clamp(arm * fade + core * smoothstep(-0.06, 0.04, s) + fill, 0.0, 1.0) * speed;
    // Never over the shore: the wake of a ship that skirts a coast stops at the sand.
    wk *= 1.0 - smoothstep(0.35, 0.65, textureLod(land, vWorld / worldSize, 0.0).r);
  }
  lay(vec3(0.93, 0.97, 1.0), wk * 0.95);

  float d = hullD(p, hp);

#ifndef FLAT
  // Shadow on the water, falling away from the light.
  if (det > 0.15) {
    float ds = hullD(p + lightL * 0.045, hp);
    lay(vec3(0.01, 0.04, 0.08), smoothstep(-0.03, 0.035, ds) * 0.42 * (0.4 + 0.6 * det));
  }
#endif

  // Foam at the waterline and the V of the bow wave.
  float tt = clamp(t, 0.0, 1.0);
  float foamW = 0.007 + 0.05 * speed * smoothstep(0.30, 1.0, tt);
  float fo = (1.0 - smoothstep(foamW * 0.5, foamW, -d)) * step(d, 0.0);
  float fn = vn(wp * 26.0 + vec2(drift * 2.0, 0.0));
  float bowArm = 0.0;
  {
    vec2 p2 = vec2(p.x, abs(p.y));
    float da = sdSeg(p2, vec2(0.49, 0.0), vec2(0.12, W * 1.12 + 0.03));
    bowArm = (1.0 - smoothstep(0.0, 0.012 + 0.010 * (0.5 - p.x) + aa, da)) * smoothstep(-0.05, 0.25, p.x) * speed * smoothstep(0.1, 0.5, fn + 0.3);
  }
  lay(vec3(0.96, 0.985, 1.0), clamp(fo * smoothstep(0.25, 0.6, fn + 0.28) + bowArm * 0.9, 0.0, 1.0) * (0.5 + 0.5 * det));
  // Far away: a pale ring round the hull, since the dark sea would swallow its outline.
  // Thick and bright round a warship, which must stand out; a thread round a trade ship.
  float ringW = vKind > 1.5 ? 3.6 : (vKind > 0.5 ? 2.2 : 1.5);
  float ringA = vKind > 1.5 ? 0.95 : (vKind > 0.5 ? 0.55 : 0.32);
  lay(vec3(0.92, 0.96, 1.0), (1.0 - smoothstep(0.0, ringW * aa, -d)) * step(d, 0.0) * ringA * (1.0 - det));

  float inside = clamp(0.5 + d / aa, 0.0, 1.0);
  if (inside > 0.0) {
    // Light from the top left: a soft pillow shape made from the distance to the edge.
    float lam = 0.9;
#ifndef FLAT
    if (det > 0.02) {
      float e0 = 0.008;
      vec2 g = vec2(hullD(p + vec2(e0, 0.0), hp) - hullD(p - vec2(e0, 0.0), hp), hullD(p + vec2(0.0, e0), hp) - hullD(p - vec2(0.0, e0), hp)) / (2.0 * e0);
      float rim = 1.0 - smoothstep(0.0, 0.055, d);
      vec3 N = normalize(vec3(-g * rim * 1.25, 1.0));
      lam = clamp(dot(N, normalize(vec3(lightL, 0.75))), 0.0, 1.2);
    }
#endif
    float shade = 0.60 + 0.62 * lam;
    vec3 ink = vec3(0.04, 0.06, 0.09);
    vec3 steel = vec3(0.50, 0.54, 0.58), steelL = vec3(0.68, 0.71, 0.73), white = vec3(0.90, 0.91, 0.90), dark = vec3(0.17, 0.19, 0.22);
    vec3 col = own;
    float u = p.x, v = p.y;
    if (det < 0.02) {
    } else if (vKind > 1.5) {
      // Warship: steel hull, owner paint on the stripe and the rim and the caps of the turrets.
      col = mix(steelL, steelL * 0.86, smoothstep(0.0, 0.07, abs(v)));
      float stripe = (1.0 - smoothstep(0.016, 0.016 + aa, abs(v))) * step(-0.36, u) * step(u, 0.36);
      col = mix(col, own, stripe);
      float edgeBand = smoothstep(0.003, 0.003 + aa, d) * (1.0 - smoothstep(0.020, 0.020 + aa, d));
      col = mix(col, own, edgeBand * 0.95);
      col = mix(col, steel * 0.62, (1.0 - smoothstep(0.0, aa, abs(d - 0.022))) * 0.5 * det);
      col *= 1.0 - 0.05 * step(0.5, fract(u * 34.0)) * det * (1.0 - stripe);
      float brd = sdBox(vec2(u, v), vec2(0.015, 0.0), vec2(0.075, 0.034));
      col = mix(col, vec3(0.2, 0.22, 0.25), (1.0 - smoothstep(-aa, aa * 3.0, sdBox(vec2(u - 0.006, v - 0.008), vec2(0.015, 0.0), vec2(0.075, 0.034)))) * 0.3 * det);
      col = mix(col, white, (1.0 - smoothstep(-aa, aa, brd)) * det);
      col = mix(col, white * 0.8, (1.0 - smoothstep(-aa, aa, sdBox(vec2(u, v), vec2(0.035, 0.0), vec2(0.03, 0.02)))) * det);
      col = mix(col, own * 0.85, (1.0 - smoothstep(-aa, aa, sdBox(vec2(u, v), vec2(-0.040, 0.0), vec2(0.010, 0.034)))) * det);
      col = mix(col, dark, (1.0 - smoothstep(-aa, aa, length(vec2(u + 0.105, v * 1.2)) - 0.030)) * det);
      col = mix(col, ink, (smoothstep(-aa, 0.0, brd) - smoothstep(0.0, aa * 1.1, brd)) * 0.45 * det);
      for (int i = 0; i < 3; i++) {
        float tx = (i == 0) ? 0.28 : ((i == 1) ? 0.185 : -0.27);
        float r = (i == 1) ? 0.028 : 0.034;
        float dir = (i == 2) ? -1.0 : 1.0;
        float brl = sdBox(vec2(u, v), vec2(tx + dir * 0.052, 0.0), vec2(0.052, 0.0055));
        float cd = length(vec2(u - tx, v)) - r;
        col = mix(col, ink, (1.0 - smoothstep(-aa, aa * 3.0, cd - 0.006)) * 0.3 * det);
        col = mix(col, dark * 0.85, (1.0 - smoothstep(-aa, aa, brl)) * det);
        col = mix(col, steel * 0.78, (1.0 - smoothstep(-aa, aa, cd)) * det);
        col = mix(col, steelL * 1.05, (1.0 - smoothstep(0.0, r * 1.3, length(vec2(u - tx + r * 0.35, v + r * 0.35)))) * (1.0 - smoothstep(-aa, aa, cd)) * 0.55 * det);
        col = mix(col, own, (1.0 - smoothstep(-aa, aa, length(vec2(u - tx, v)) - r * 0.38)) * det);
        col = mix(col, ink, (smoothstep(-aa, 0.0, cd) - smoothstep(0.0, aa * 1.1, cd)) * 0.6 * det);
      }
    } else if (vKind > 0.5) {
      // Transport: a blunt landing barge, owner deck, crates aft, troops forward, a bow ramp.
      col = own * 0.95 * (1.0 - 0.07 * step(0.5, fract(u * 34.0)) * det);
      col = mix(col, vec3(0.22, 0.24, 0.27), (1.0 - smoothstep(0.016, 0.016 + aa, d)) * 0.95);
      for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 2; j++) {
          vec2 cc = vec2(-0.205 + float(i) * 0.105, (float(j) - 0.5) * 0.115);
          float cd = sdBox(vec2(u, v), cc, vec2(0.043, 0.047));
          vec3 tarp = mix(vec3(0.60, 0.52, 0.36), vec3(0.42, 0.47, 0.35), h21(vec2(float(i), float(j) + seed)));
          col = mix(col, ink, (1.0 - smoothstep(-aa, aa * 3.0, cd - 0.006)) * 0.25 * det);
          col = mix(col, tarp * (0.9 + 0.2 * step(0.0, -(v - cc.y))), (1.0 - smoothstep(-aa, aa, cd)) * det);
        }
      }
      for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4; j++) {
          float cd = length(vec2(u, v) - vec2(0.135 + float(i) * 0.052, (float(j) - 1.5) * 0.050)) - 0.0185;
          col = mix(col, ink, (1.0 - smoothstep(-aa, aa, cd - 0.004)) * 0.5 * det);
          col = mix(col, mix(own, vec3(1.0), 0.55), (1.0 - smoothstep(-aa, aa, cd)) * det);
        }
      }
      float rp = sdBox(vec2(u, v), vec2(0.405, 0.0), vec2(0.045, 0.082));
      col = mix(col, steelL * 0.9, (1.0 - smoothstep(-aa, aa, rp)) * det * step(u, 0.44));
      col = mix(col, ink, (smoothstep(-aa, 0.0, rp) - smoothstep(0.0, aa * 1.1, rp)) * 0.5 * det);
      float brd = sdBox(vec2(u, v), vec2(-0.34, 0.0), vec2(0.075, 0.085));
      col = mix(col, ink, (1.0 - smoothstep(-aa, aa * 3.0, brd - 0.006)) * 0.28 * det);
      col = mix(col, white, (1.0 - smoothstep(-aa, aa, brd)) * det);
      col = mix(col, own * 0.8, (1.0 - smoothstep(-aa, aa, sdBox(vec2(u, v), vec2(-0.34, 0.0), vec2(0.010, 0.085)))) * det);
      col = mix(col, ink, (smoothstep(-aa, 0.0, brd) - smoothstep(0.0, aa * 1.1, brd)) * 0.5 * det);
      col = mix(col, dark, (1.0 - smoothstep(-aa, aa, length(vec2(u + 0.38, v)) - 0.02)) * det);
    } else {
      // Trade ship: owner-painted hull, stacks of containers, an aft bridge.
      col = mix(own * 0.92, own * 0.62, 1.0 - smoothstep(0.016, 0.016 + aa, d));
      float deckBox = sdBox(vec2(u, v), vec2(0.05, 0.0), vec2(0.34, 0.075));
      col = mix(col, vec3(0.22, 0.24, 0.27), (1.0 - smoothstep(-aa, aa, deckBox)) * det);
      for (int i = 0; i < 6; i++) {
        for (int j = 0; j < 3; j++) {
          vec2 cc = vec2(-0.24 + float(i) * 0.1, (float(j) - 1.0) * 0.048);
          float hsh = h21(vec2(float(i) * 1.7 + seed, float(j) * 2.9));
          vec3 cn = hsh < 0.25 ? own * 1.1 : (hsh < 0.5 ? vec3(0.78, 0.76, 0.70) : (hsh < 0.75 ? vec3(0.52, 0.58, 0.62) : vec3(0.74, 0.62, 0.45)));
          float cd = sdBox(vec2(u, v), cc, vec2(0.044, 0.021));
          col = mix(col, cn * (0.82 + 0.3 * step(0.0, -(v - cc.y))), (1.0 - smoothstep(-aa, aa, cd)) * det);
        }
      }
      float brd = sdBox(vec2(u, v), vec2(-0.385, 0.0), vec2(0.045, 0.075));
      col = mix(col, white, (1.0 - smoothstep(-aa, aa, brd)) * det);
      col = mix(col, ink, (smoothstep(-aa, 0.0, brd) - smoothstep(0.0, aa * 1.1, brd)) * 0.5 * det);
      col = mix(col, own * 0.7, (1.0 - smoothstep(-aa, aa, length(vec2(u + 0.405, v)) - 0.02)) * det);
    }
    // Far away: the owner's colour whole, with a mark that survives at 18 px:
    // a turret for the warship, a notch for the transport, two blocks for the trade ship.
    float mk;
    if (vKind > 1.5) mk = 1.0 - smoothstep(-aa, aa, length(vec2(u - 0.14, v)) - 0.07 * boost * 0.7);
    else if (vKind > 0.5) mk = 1.0 - smoothstep(-aa, aa, sdBox(vec2(u, v), vec2(-0.30, 0.0), vec2(0.10, 0.2 * W / 0.15)));
    else mk = max(1.0 - smoothstep(-aa, aa, sdBox(vec2(u, v), vec2(-0.2, 0.0), vec2(0.07, 0.19 * W / 0.15))), 1.0 - smoothstep(-aa, aa, sdBox(vec2(u, v), vec2(0.12, 0.0), vec2(0.07, 0.19 * W / 0.15))));
    vec3 mkc = vKind > 1.5 ? vec3(0.05, 0.07, 0.11) : vec3(0.97, 0.98, 1.0);
    col = mix(mix(own * 0.92, mkc, mk * 0.85), col, det);
    col *= mix(0.80 + 0.35 * lam, shade, det);
    // A dark edge, thinner as you come closer.
    float ow = mix(1.4, 0.9, det) * aa;
    col = mix(col, ink, (1.0 - smoothstep(ow, ow + aa, d)) * mix(0.85, 0.55, det));
    lay(col, inside);
  }

  // A warship that has just fired: its guns flash and a ring of light runs round the hull.
  // With motion reduced the flash is left out and the ring only glows, softer and still.
  if (vFlash > 0.001 && vKind > 1.5) {
    float soft = reduced > 0.5 ? 0.5 : 1.0;
    float gr = max(0.10, 7.0 * tilesPerPixel / L);
    float muzzle = 0.0;
    muzzle += exp(-dot(p - vec2(0.28, 0.0), p - vec2(0.28, 0.0)) / (gr * gr));
    muzzle += exp(-dot(p - vec2(0.185, 0.0), p - vec2(0.185, 0.0)) / (gr * gr)) * 0.8;
    float halo = (1.0 - smoothstep(0.0, 2.0 * aa + 0.006, abs(d - 0.01))) * smoothstep(-0.1, 0.1, p.x + 0.55);
    lay(vec3(1.0, 0.86, 0.5), clamp(muzzle, 0.0, 1.0) * vFlash * (reduced > 0.5 ? 0.0 : 0.95));
    lay(vec3(1.0, 0.95, 0.78), halo * vFlash * 0.75 * soft);
  }

  // Fade out at the border of the quad so that a wide wake never shows a seam.
  float edgeFade = (1.0 - smoothstep(1.75, 2.0, -p.x)) * (1.0 - smoothstep(0.72, 0.85, abs(p.y)));
  PC *= edgeFade; PA *= edgeFade;
  if (PA < 0.002) discard;
  outColor = vec4(PC, PA);
}`;

/** The colour of `#RRGGBB` as sRGB red, green and blue in 0 to 1: the shader paints in sRGB and writes it out as it is. */
function srgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * Every hull of the map in one instanced draw call. Positions are in tiles;
 * the vertex shader moves each hull next to the camera across the east-west
 * seam. The shore is a mask of the water, so that no wake crosses land.
 */
export class ShipLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly position: THREE.InstancedBufferAttribute;
  private readonly angle: THREE.InstancedBufferAttribute;
  private readonly kind: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly landTexture: THREE.DataTexture;
  private readonly time = { value: 0 };
  private readonly cameraX = { value: 0 };
  private readonly tilesPerPixel = { value: 1 };
  private readonly reduced = { value: 0 };
  private dirty = false;

  constructor(readonly options: ShipLayerOptions) {
    const { capacity, worldWidth, worldHeight } = options;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (size: number): THREE.InstancedBufferAttribute => {
      const made = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      made.setUsage(THREE.DynamicDrawUsage);
      return made;
    };
    this.position = attribute(2);
    this.angle = attribute(1);
    this.kind = attribute(4);
    this.color = attribute(3);
    geometry.setAttribute("iPos", this.position);
    geometry.setAttribute("iAng", this.angle);
    geometry.setAttribute("iKind", this.kind);
    geometry.setAttribute("iCol", this.color);
    geometry.instanceCount = 0;

    // 255 on land, 0 at sea, filtered linearly so that the shore is soft under the wake.
    const mask = new Uint8Array(worldWidth * worldHeight);
    for (let i = 0; i < mask.length; i++) mask[i] = options.kinds[i] === 0 ? 0 : 255;
    this.landTexture = new THREE.DataTexture(mask, worldWidth, worldHeight, THREE.RedFormat);
    this.landTexture.internalFormat = "R8";
    this.landTexture.magFilter = THREE.LinearFilter;
    this.landTexture.minFilter = THREE.LinearFilter;
    this.landTexture.generateMipmaps = false;
    this.landTexture.unpackAlignment = 1;
    this.landTexture.wrapS =
      options.wrapsX === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    this.landTexture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: options.flat ? { FLAT: 1 } : {},
      vertexShader,
      fragmentShader,
      uniforms: {
        worldWidth: { value: worldWidth },
        worldHeight: { value: worldHeight },
        worldSize: { value: new THREE.Vector2(worldWidth, worldHeight) },
        wrapsX: { value: options.wrapsX ?? true },
        cameraX: this.cameraX,
        tilesPerPixel: this.tilesPerPixel,
        phone: { value: options.phone ? PHONE_FACTOR : 1 },
        detail: { value: new THREE.Vector2(DETAIL_FROM, DETAIL_TO) },
        time: this.time,
        reduced: this.reduced,
        light: { value: new THREE.Vector2(-0.55, -0.65).normalize() },
        land: { value: this.landTexture },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.geometry.instanceCount;
  }

  /** Replaces every hull; the caller orders them, so that the later ones are drawn over the earlier. */
  setHulls(hulls: readonly Hull[]): void {
    const count = Math.min(hulls.length, this.options.capacity);
    for (let i = 0; i < count; i++) {
      const hull = hulls[i] as Hull;
      this.position.setXY(i, hull.x, hull.y);
      this.angle.setX(i, hull.heading);
      this.kind.setXYZW(
        i,
        KIND_ID[hull.kind],
        hull.flash ?? 0,
        Math.min(1, hull.speed / FULL_SPEED),
        hull.seed,
      );
      const [r, g, b] = srgb(hull.color);
      this.color.setXYZ(i, r, g, b);
    }
    this.mesh.geometry.instanceCount = count;
    this.dirty = true;
  }

  /** Whether the player accepts motion; held still, the foam keeps its place but no longer drifts. */
  setMotion(moving: boolean): void {
    this.reduced.value = moving ? 0 : 1;
  }

  /** Follows the clock and the camera, and uploads the hulls set since the last call. */
  update(time: number, cameraX: number, tilesPerPixel: number): void {
    this.time.value = time;
    this.cameraX.value = cameraX;
    this.tilesPerPixel.value = tilesPerPixel;
    if (!this.dirty) return;
    this.dirty = false;
    for (const attribute of [this.position, this.angle, this.kind, this.color]) {
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.landTexture.dispose();
  }
}
