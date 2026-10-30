/*
 * The shaders of an explosion on the flat map (art-direction.md, Effects): a
 * fireball of rolling spheres, smoke lit by the same north-west light as the
 * relief and throwing its shadow on the ground, a shock wave, sparks, embers
 * and clods of earth. One fragment shader draws all of it from the time alone,
 * so a strike costs the CPU nothing once started. It is drawn either straight
 * into the map or, for a large blast, into a half-resolution target that a
 * second shader then lays over the map (explosion-layer.ts).
 */

/** Hash, value noise and the segment distance the explosion needs. */
const NOISE = /* glsl */ `
precision highp float;

#define PI 3.14159265359
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return s; }
float fbm3(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return s; }
// distance to a segment
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
`;

/** A quad that carries its own coordinates, in a unit square. */
export const EXPLOSION_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The explosion, premultiplied so that the fire can add light and the smoke can cover. */
const EXPLOSION = /* glsl */ `
// Seconds since the strike, the radius in raster pixels, 1 for a heavy missile, a seed,
// 1 for a burst in the air, the direction of the light and 1 for the full picture (0 for a saver).
uniform float uT, uR, uHeavy, uSeed, uAir;
uniform vec2 uLight;
uniform float uQuality;
varying vec2 vUv;
vec3 gcol; float ga;
void over(vec3 c, float al) { gcol = c * al + gcol * (1.0 - al); ga = al + ga * (1.0 - al); }

vec3 fireRamp(float h) {
  vec3 c = vec3(0.05, 0.024, 0.02);
  c = mix(c, vec3(0.46, 0.08, 0.03), smoothstep(0.05, 0.26, h));
  c = mix(c, vec3(0.97, 0.33, 0.05), smoothstep(0.24, 0.52, h));
  c = mix(c, vec3(1.00, 0.70, 0.20), smoothstep(0.50, 0.80, h));
  c = mix(c, vec3(1.00, 0.95, 0.78), smoothstep(0.80, 1.10, h));
  return c;
}

// A cluster of spheres seen from above: gives billowing outlines and a lit normal for each pixel.
// returns xyz = normal, w = coverage; height of the top sphere in hgt (0..1, in units of its own size)
vec4 cluster(vec2 p, float spread, float size, float seed, out float hgt, out float dist01) {
  float dens = 0.0; vec2 grad = vec2(0.0); float dsum = 0.0;
  p += (vec2(fbm3(p * 2.6 + seed), fbm3(p * 2.6 + seed + 7.3)) - 0.5) * 0.34 * size;
  for (int i = 0; i < 13; i++) {
    vec2 h = h22(vec2(float(i) * 1.7 + seed, 4.1));
    vec2 g = h22(vec2(float(i) * 3.3 + seed, 8.8));
    float a = h.x * 6.2831;
    float rr = sqrt(h.y);
    vec2 c = vec2(cos(a), sin(a)) * rr * spread;
    float s = size * (0.55 + 0.7 * g.x);
    vec2 d = (p - c) / s;
    float f = max(0.0, 1.0 - dot(d, d));
    float wgt = 0.7 + 0.6 * g.y;
    dens += f * f * wgt;
    grad += (-4.0 * f * d) * wgt;
    dsum += f * f * wgt * length(c);
  }
  float det = fbm3(p * 7.0 + seed * 1.7) - 0.5;
  float dn = dens + det * 0.35;
  hgt = clamp(dn, 0.0, 1.6) / 1.6 * 1.5;
  dist01 = clamp(dsum / max(dens, 1e-3) / max(spread, 1e-3), 0.0, 1.0);
  vec3 n = normalize(vec3(-grad * 0.36 + vec2(det, fbm3(p * 7.0 + 3.1) - 0.5) * 0.8, 1.0));
  return vec4(n, smoothstep(0.10, 0.60, dn));
}

void main() {
  // The quad spans 2.55 radii a side, and y points south as in the sketches.
  vec2 p = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0) * 2.55;
  float r = length(p);
  float T = uT;
  float dur = mix(2.1, 3.0, uHeavy);
  float tn = clamp(T / dur, 0.0, 1.0);
  float sd = uSeed * 5.31;
  gcol = vec3(0.0); ga = 0.0;
  vec3 add = vec3(0.0);
  float air = uAir;
  vec3 L3 = normalize(vec3(uLight, 0.75));

  // --- warm light thrown on the ground (additive), widest at the flash
  add += vec3(1.0, 0.43, 0.10) * exp(-r * r * 0.7) * exp(-T * 2.2) * 0.17 * (1.0 - air * 0.5) * smoothstep(0.0, 0.03, T);

  // --- shock wave: a bright crest and a dust band behind (the ground bends under it in the terrain shader)
  float rs = (1.75 + 0.35 * uHeavy) * (1.0 - exp(-T * 3.2));
  float w = 0.06 + 0.11 * (T / (T + 0.45));
    float fade = smoothstep(0.0, 0.02, T) * (1.0 - smoothstep(0.22, 0.95, T));
  if (fade > 0.001 && abs(r - rs) < w * 4.5 + 0.6) {
    float band = smoothstep(rs - 0.60, rs - 0.05, r) * (1.0 - smoothstep(rs - 0.05, rs + 0.03, r));
    float dn = fbm3(p * 6.0 + sd + T * 0.5);
    float dust = band * smoothstep(0.30, 0.75, dn) * fade * 0.40 * (1.0 - air);
    over(vec3(0.52, 0.43, 0.33), dust);
    add += vec3(1.0, 0.93, 0.80) * exp(-pow((r - rs) / (w * 0.34), 2.0)) * fade * 0.20;
  }

  // --- smoke: sphere cluster, lit from the top-left, underlit by the fire, throwing a shadow on the ground
  float st = smoothstep(0.08, 0.40, T);
  if (st > 0.0 && tn < 0.995 && r < 1.45) {
    float grow = 1.0 - exp(-T * 1.25);
    float spread = (0.30 + 0.62 * grow) * mix(1.0, 0.55, air);
    float size = (0.36 + 0.22 * grow) * mix(1.0, 0.6, air);
    float hg, d01;
    // shadow first: the same cluster, shifted away from the light
    vec2 shOff = -uLight * (0.16 + 0.22 * grow);
    float hs, ds;
    float shadow = 0.0;
    if (uQuality > 0.5) { vec4 cs = cluster(p - shOff, spread, size, 3.0 + sd, hs, ds); shadow = cs.w * st * (1.0 - smoothstep(0.35, 1.0, tn)) * 0.20 * (1.0 - air); }
    over(vec3(0.0, 0.01, 0.02), shadow);
    vec4 c = cluster(p, spread, size, 3.0 + sd, hg, d01);
    float erodeN = fbm3(p * 5.5 + sd + vec2(0.0, -T * 0.2));
    float cov = c.w * clamp((erodeN + 0.55 - tn * 1.15 - (1.0 - hg) * 0.2) * 3.0, 0.0, 1.0);
    if (cov > 0.0) {
      float lam = clamp(dot(c.xyz, L3) * 0.62 + 0.42, 0.0, 1.0);
      float amb = 0.40 + 0.14 * c.z;
      vec3 dark = mix(vec3(0.115, 0.10, 0.092), vec3(0.22, 0.20, 0.185), tn);
      vec3 pale = mix(vec3(0.62, 0.53, 0.45), vec3(0.62, 0.61, 0.61), tn);
      vec3 sc = mix(dark, pale, clamp(lam * 1.15, 0.0, 1.0) * (0.55 + 0.45 * hg)) * (0.55 + amb);
      // dense core stays sooty, edges thin and pale
      sc = mix(sc, dark * 0.9, (1.0 - d01) * 0.35 * (1.0 - tn));
      // the fire lights the smoke from within, strongest near the centre and early
      float inner = exp(-r * r * 2.4) * (1.0 - smoothstep(0.05, 0.95, T));
      sc += vec3(0.95, 0.36, 0.07) * inner * (0.35 + 0.65 * (1.0 - c.z)) * 0.9;
      sc = mix(sc, vec3(0.80, 0.83, 0.86) * (0.6 + 0.4 * lam), air * 0.6);
      over(sc, cov * st * 0.94);
    }
  }

  // --- fireball: rolling spheres, hot at the heart and on top of each bulge, cooling to soot
  float grow = 1.0 - exp(-T * 8.0);
  float life = 1.0 - smoothstep(0.30, 1.05, T);
  if (life > 0.0 && T < 1.1 && r < 1.0) {
    float spread = 0.40 * grow * (1.0 + 0.25 * smoothstep(0.1, 0.6, T)) * mix(1.0, 0.7, air);
    float size = 0.38 * (0.55 + 0.45 * grow) * mix(1.0, 0.7, air);
    float hg, d01;
    vec4 c = cluster(p, spread, size, 11.0 + sd, hg, d01);
    float t1 = fbm(p * 4.0 + sd + vec2(T * 0.9, -T * 1.4));
    float temp = (0.28 + 0.55 * c.z + 0.30 * (1.0 - d01) + 0.35 * (t1 - 0.5)) * (1.28 - 1.05 * smoothstep(0.02, 0.85, T));
    float cov = c.w * life;
    if (cov > 0.0) {
      vec3 fc = fireRamp(temp);
      over(fc, cov * smoothstep(0.03, 0.14, temp));
      add += fc * smoothstep(0.58, 1.05, temp) * 0.30 * life;
    }
  }

  // --- heat flash: a short white-hot bloom, tight
  float glow = exp(-r * r * 4.5) * exp(-T * 14.0) * 1.8 + exp(-r * r * 0.9) * exp(-T * 10.0) * 0.30 + exp(-r * r * 40.0) * exp(-T * 24.0) * 1.2;
  add += vec3(1.0, 0.85, 0.58) * glow * smoothstep(-0.01, 0.01, T);

  // --- sparks (short streaks) and rising embers (slow glowing dots), then clods of earth that stay
  if (uQuality > 0.5 && r < 2.5) {
    for (int i = 0; i < 22; i++) {
      float fi = float(i) + uSeed * 13.0;
      vec2 h = h22(vec2(fi, 3.7));
      vec2 hh = h22(vec2(fi, 9.1));
      float life2 = 0.30 + hh.x * 0.55;
      if (T > life2 || T < 0.0) continue;
      float ang = h.x * 6.2831;
      float sp = (0.55 + h.y * 1.25) * (1.0 + 0.25 * uHeavy);
      float v0 = 0.9 + hh.y * 1.3;
      vec2 dir = vec2(cos(ang), sin(ang));
      float t1 = T, t0 = max(0.0, T - 0.035);
      vec2 p1 = dir * sp * (1.0 - exp(-t1 * 3.4)) - vec2(0.0, max(0.0, v0 * t1 - 2.0 * t1 * t1) * 0.5);
      vec2 p0 = dir * sp * (1.0 - exp(-t0 * 3.4)) - vec2(0.0, max(0.0, v0 * t0 - 2.0 * t0 * t0) * 0.5);
      float d = sdSeg(p, p0, p1);
      float wd = max(0.010 + 0.005 * hh.x, 1.3 / uR);
      float g = smoothstep(wd, 0.0, d) + exp(-d * d / (wd * wd * 9.0)) * 0.4;
      float k = 1.0 - T / life2;
      add += mix(vec3(1.0, 0.34, 0.07), vec3(1.0, 0.92, 0.65), k) * g * k * (1.0 - air * 0.4);
    }
    for (int i = 0; i < 14; i++) {
      float fi = float(i) + uSeed * 3.0 + 70.0;
      vec2 h = h22(vec2(fi, 2.9));
      vec2 hh = h22(vec2(fi, 5.5));
      float life3 = 0.9 + hh.x * 1.3;
      if (T > life3 || T < 0.12) continue;
      float ang = h.x * 6.2831;
      float rad = (0.20 + 0.75 * h.y) * (1.0 - exp(-T * 2.2));
      vec2 pos = vec2(cos(ang), sin(ang)) * rad + vec2(0.05 * sin(T * 3.0 + fi), -T * 0.18 * (0.5 + hh.y));
      float k = (1.0 - T / life3) * (0.6 + 0.4 * sin(T * 22.0 + fi * 4.0));
      float g = exp(-dot(p - pos, p - pos) / (0.0009 + 0.0004 * hh.y) * 1.0 / max(0.5, uR / 80.0));
      add += vec3(1.0, 0.45, 0.12) * g * k * 1.4 * (1.0 - air);
    }
    for (int i = 0; i < 16; i++) {
      float fi = float(i) + uSeed * 5.0 + 40.0;
      vec2 h = h22(vec2(fi, 1.3));
      vec2 hh = h22(vec2(fi, 7.7));
      float land = 0.45 + hh.x * 0.6;
      float tt = min(T, land);
      float ang = h.x * 6.2831;
      float sp = (0.35 + h.y * 1.0);
      vec2 pos = vec2(cos(ang), sin(ang)) * sp * (1.0 - exp(-tt * 3.0)) - vec2(0.0, max(0.0, (1.1 + hh.y) * tt - 2.2 * tt * tt) * 0.4);
      float rad = (0.012 + 0.016 * hh.y) * (1.0 - air);
      float cc = smoothstep(rad, rad * 0.55, length(p - pos));
      over(vec3(0.07, 0.055, 0.045), cc * 0.85 * smoothstep(0.0, 0.05, T));
    }
  }

  gl_FragColor = vec4(gcol + add, ga);
}`;

export const EXPLOSION_FRAGMENT = NOISE + EXPLOSION;

/** Lays a half-resolution explosion over the map. */
export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}`;
