import type * as Three from "three";
import type { ThreeParts } from "./effects-layer.ts";
import {
  blastScale,
  courseOf,
  fixAt,
  groundHeading,
  headingAt,
  trailOf,
  type Course,
  type CourseMap,
} from "./missile-flight.ts";
import type { UnitMark } from "./renderer.ts";

/*
 * A missile in flight, drawn as an object (art-direction.md, Motion): a steel
 * body with a band in the colour of whoever launched it and an ember nose,
 * seen from above and lit from the north-west like the relief, on an arc that
 * lifts it off the land; its shadow on the ground, tightening as it comes
 * down; a trail of smoke puffs behind; and, on the target, a circle at the real
 * radius of the blast that closes in and pulses faster as the missile
 * arrives. Three draws for the missiles, one for the trails. Held still, the
 * body stays but the flame, the smoke and the pulse do not move.
 */

/** Missiles in flight at once, as many as the map keeps plates for. */
const CAPACITY = 256;
/** Puffs of smoke alive at once, over every trail. */
const PUFFS = 1536;
/** Trails left behind missiles that ended, which fade after them. */
const GHOSTS = 32;
/** Most puffs one trail is made of. */
const TRAIL_PUFFS = 56;

/** Seconds a puff lives, for a light and a heavy missile. */
const LIFE = { light: 2.4, heavy: 3 } as const;
/** Spacing of the puffs on screen in CSS pixels: tight with the full picture, loose without. */
const SPACING_PIXELS = { rich: 6, light: 12 } as const;
/** Tiles a second a missile is taken to fly while its speed is not yet known. */
const MIN_SPEED = 4;

/**
 * Length of a body in tiles, and the fewest and most CSS pixels it takes on
 * screen: far out it stays a readable shape, close in it does not grow without end.
 */
const BODY = {
  light: { tiles: 6, minPixels: 24, maxPixels: 84 },
  heavy: { tiles: 9, minPixels: 32, maxPixels: 110 },
} as const;

/** Smallest circle on the target in CSS pixels, however far the view is zoomed out. */
const RING_MIN_PIXELS = 14;

/** Height above the map, as the effects' (they draw over units). */
const DEPTH = 0.45;
const DYNAMIC_DRAW = 35048;
const GLSL3 = "300 es";

/** Blending for colours already multiplied by their alpha, so that a flame can add light: `CustomBlending`, add, one, one minus source alpha. */
const PREMULTIPLIED = {
  blending: 5,
  blendEquation: 100,
  blendSrc: 201,
  blendDst: 205,
} as const;

export interface MissileLayerOptions {
  readonly three: ThreeParts;
  readonly map: CourseMap;
  readonly scene: Three.Object3D;
  readonly anchor: Three.Vector3;
  /** Whether the player accepts motion. */
  readonly moving: boolean;
  /** The full picture, or the light one of a weak device: no shadow, no noise, a sparser trail. */
  readonly rich: boolean;
}

/** A missile of this frame. */
interface Live {
  course: Course | undefined;
  /** How far along the course, from 0 to 1. */
  s: number;
  x: number;
  y: number;
  heading: number;
  heavy: boolean;
  speed: number;
  rgb: readonly [number, number, number];
  radius: number;
  pass: number;
}

/** What is left of a missile that ended: its trail, aging. */
interface Ghost {
  course: Course;
  s: number;
  heavy: boolean;
  speed: number;
  endedAt: number;
}

const commonUniforms = /* glsl */ `
  uniform float worldWidth;
  uniform float cameraX;
  uniform bool wrapsX;
  uniform float tilesPerPixel;
  uniform float depth;
  uniform float time;
  uniform float moving;

  // Where a point offset tiles from center is on screen, on the copy of the
  // world closest to the camera, judged by the centre.
  vec4 placed(vec2 center, vec2 offset) {
    vec4 middle = modelMatrix * vec4(center, depth, 1.0);
    vec4 world = modelMatrix * vec4(center + offset, depth, 1.0);
    if (wrapsX) world.x += worldWidth * floor((cameraX - middle.x) / worldWidth + 0.5);
    return projectionMatrix * viewMatrix * world;
  }
`;

const missileInputs = /* glsl */ `
  // The body: x, y in tiles with y pointing north, heading, altitude.
  in vec4 aBody;
  // The shadow's ground point: x, y, heading along the ground, how far along.
  in vec4 aGround;
  // Length of the body in tiles, its smallest and largest on screen in pixels, 1 for a heavy one.
  in vec4 aSize;
  // The colour of the launcher, then the blast radius in tiles.
  in vec4 aOwner;
  // The target: x, y.
  in vec4 aTarget;
`;

/** The direction towards the light on the ground, north-west. */
const LIGHT = "vec2(-0.62, 0.78)";

const bodyVertex = /* glsl */ `
  ${commonUniforms}
  ${missileInputs}
  out vec2 vP;
  out float vPixels;
  out vec3 vOwner;
  out float vHeavy;
  out vec2 vLight;

  void main() {
    float length_ = clamp(aSize.x, aSize.y * tilesPerPixel, aSize.z * tilesPerPixel);
    // The body is 1.9 S long: 0.86 S behind the centre and 1.02 S ahead of it.
    float s = length_ / 1.9 * (1.0 + 0.5 * aBody.w);
    vec2 q = position.xy * 2.0 * vec2(2.5, 0.95);
    float c = cos(aBody.z), n = sin(aBody.z);
    vec2 offset = s * vec2(c * q.x - n * q.y, n * q.x + c * q.y);
    vP = q;
    vPixels = s / tilesPerPixel;
    vOwner = aOwner.rgb;
    vHeavy = aSize.w;
    vec2 light = ${LIGHT};
    vLight = vec2(c * light.x + n * light.y, -n * light.x + c * light.y);
    gl_Position = placed(aBody.xy, offset);
  }
`;

const noise = /* glsl */ `
  float h12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm3(vec2 p) {
    float a = .5, s = 0.;
    for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; }
    return s;
  }
`;

const shapes = /* glsl */ `
  float aa(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    vec2 v0 = p - a, v1 = p - b, v2 = p - c;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                 vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }
`;

const bodyFragment = /* glsl */ `
  uniform float rich;
  uniform float time;
  uniform float moving;
  in vec2 vP;
  in float vPixels;
  in vec3 vOwner;
  in float vHeavy;
  in vec2 vLight;
  layout(location = 0) out highp vec4 outColor;
  ${shapes}
  ${noise}

  void main() {
    // In bodies: +x is forward, and the rocket spans about -0.86 to 1.02.
    vec2 p = vP;
    float w = 0.19 + 0.04 * vHeavy;
    float dBody = sdBox(p - vec2(-0.2, 0.0), vec2(0.65, w));
    float dNose = sdTri(p, vec2(0.45, w), vec2(0.45, -w), vec2(1.02, 0.0));
    float dFin = min(sdTri(p, vec2(-0.86, w * 0.9), vec2(-0.86, 0.56), vec2(-0.40, w * 0.9)),
                     sdTri(p, vec2(-0.86, -w * 0.9), vec2(-0.86, -0.56), vec2(-0.40, -w * 0.9)));
    float dm = min(min(dBody, dNose), dFin);
    float body = aa(dm, 0.9 / vPixels);
    float outline = smoothstep(0.035, 0.0, -dm);
    vec3 steel = vec3(0.84, 0.87, 0.90);
    float yn = clamp(p.y / w, -1.0, 1.0);
    vec3 n = vec3(0.0, yn, sqrt(max(0.0, 1.0 - yn * yn)));
    vec3 l = normalize(vec3(vLight, 0.85));
    float lam = clamp(dot(n, l), 0.0, 1.0);
    vec3 c = steel * (0.38 + 0.78 * lam);
    // The launcher's band and fins.
    float band = smoothstep(0.02, 0.0, abs(p.x + 0.22) - 0.16);
    c = mix(c, vOwner * (0.55 + 0.6 * lam), band * step(abs(p.y), w));
    float fins = step(dFin, dBody) * step(w * 0.95, abs(p.y));
    c = mix(c, vOwner * 0.9, fins);
    // The ember nose, and a white glint along the body.
    float nose = smoothstep(0.0, 0.02, p.x - 0.52);
    c = mix(c, vec3(0.95, 0.30, 0.10) * (0.55 + 0.6 * lam), nose * step(dBody, dNose + 0.2));
    c += vec3(1.0) * smoothstep(0.1, 0.0, abs(p.y + w * 0.45 * (l.y > 0.0 ? -1.0 : 1.0))) * 0.10 * step(p.x, 0.45) * step(-0.85, p.x);
    c = mix(c, vec3(0.04, 0.06, 0.09), outline * 0.85);
    // The exhaust, behind the tail, which adds light.
    float fx = -(p.x + 0.86);
    float flame = 0.0;
    if (fx > 0.0) {
      float len = 1.55 + 0.4 * vHeavy;
      float profile = (0.15 + 0.03 * vHeavy) * (1.0 - fx / len);
      float flicker = 1.0;
      if (moving > 0.5) {
        flicker = rich > 0.5
          ? 0.85 + 0.3 * fbm3(vec2(fx * 6.0 - time * 26.0, p.y * 5.0))
          : 0.85 + 0.3 * sin(time * 40.0 + fx * 9.0);
      }
      float dd = abs(p.y) / max(profile * flicker, 0.001);
      flame = smoothstep(1.0, 0.0, dd) * smoothstep(len, 0.0, fx) * flicker;
    }
    vec3 fire = mix(vec3(1.0, 0.45, 0.10), vec3(1.0, 0.95, 0.75), smoothstep(0.35, 1.0, flame));
    outColor = vec4(c * body + fire * flame * 1.2, body);
  }
`;

const shadowVertex = /* glsl */ `
  ${commonUniforms}
  ${missileInputs}
  out vec2 vP;
  out float vAlt;

  void main() {
    float length_ = clamp(aSize.x, aSize.y * tilesPerPixel, aSize.z * tilesPerPixel);
    float s = length_ / 1.9 * (1.0 + 0.5 * aBody.w) * 1.15;
    // Away from the light, further the higher the missile is.
    vec2 light = ${LIGHT};
    vec2 center = aGround.xy - light * aBody.w * s * 1.0;
    vec2 q = position.xy * 2.0 * vec2(1.7, 0.65);
    float c = cos(aGround.z), n = sin(aGround.z);
    vec2 offset = s * vec2(c * q.x - n * q.y, n * q.x + c * q.y);
    vP = q;
    vAlt = aBody.w;
    gl_Position = placed(center, offset);
  }
`;

const shadowFragment = /* glsl */ `
  in vec2 vP;
  in float vAlt;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    float d = length(vec2(vP.x * 0.62, vP.y * 1.7));
    float soft = 0.25 + 0.7 * vAlt;
    float a = smoothstep(1.0, 1.0 - soft, d) * 0.4 * (1.0 - 0.5 * vAlt);
    outColor = vec4(vec3(0.0, 0.02, 0.04) * a, a);
  }
`;

const ringVertex = /* glsl */ `
  ${commonUniforms}
  ${missileInputs}
  out vec2 vP;
  out float vRadius;
  out float vProgress;

  void main() {
    // The circle is the blast radius, and no smaller than a mark that can be seen.
    float radius = max(aOwner.w / tilesPerPixel, ${RING_MIN_PIXELS.toFixed(1)});
    vec2 q = position.xy * 2.0 * radius * 1.5;
    vP = q;
    vRadius = radius;
    vProgress = aGround.w;
    gl_Position = placed(aTarget.xy, q * tilesPerPixel);
  }
`;

const ringFragment = /* glsl */ `
  uniform float time;
  uniform float moving;
  in vec2 vP;
  in float vRadius;
  in float vProgress;
  layout(location = 0) out highp vec4 outColor;
  ${shapes}

  void main() {
    float r = length(vP);
    float live = moving;
    // The outer ring closes in on the blast radius as the missile arrives, pulsing faster.
    float ring = vRadius * (1.0 + live * 0.30 * (1.0 - vProgress) * (1.0 - vProgress));
    float pulse = live > 0.5 ? 0.5 + 0.5 * sin(time * (5.0 + 9.0 * vProgress)) : 0.5;
    float width = 2.0 + 0.8 * pulse;
    float line = aa(abs(r - ring) - width, 0.8);
    // A dark edge under the line, so that it reads on light land as on dark.
    float edge = aa(abs(r - ring) - (width + 1.6), 0.8);
    // Dashes, turning slowly: the shape says it is a mark, whatever the colour.
    float angle = atan(vP.y, vP.x) + live * time * 0.6;
    float dash = smoothstep(0.35, 0.45, abs(fract(angle * 14.0 / 6.2831) - 0.5) * 2.0);
    line *= 0.35 + 0.65 * dash;
    float fill = smoothstep(ring, ring * 0.2, r) * (0.05 + 0.10 * vProgress);
    // Four ticks pointing in.
    float tick = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 1.5708 + 0.785398;
      vec2 d = vec2(cos(a), sin(a));
      tick = max(tick, aa(sdSeg(vP, d * ring * 0.80, d * ring * 0.94) - 1.4, 0.8));
    }
    vec3 color = mix(vec3(0.95, 0.36, 0.16), vec3(1.0, 0.78, 0.4), pulse * vProgress);
    float lit = clamp(line * (0.8 + 0.2 * pulse) + fill + tick * 0.8, 0.0, 1.0);
    float shade = edge * (0.28 + 0.12 * dash) * (1.0 - lit);
    float fade = smoothstep(0.0, 0.1, vProgress + 0.1);
    float a = (lit + shade) * fade;
    outColor = vec4((color * lit + vec3(0.02, 0.04, 0.07) * shade) * fade, a * 0.92);
  }
`;

const puffVertex = /* glsl */ `
  ${commonUniforms}
  // The centre in tiles, its diameter in tiles and its age from 0 to 1.
  in vec4 aPuff;
  // A fixed random number, and 1 for the smoke of a heavy missile.
  in vec2 aMark;
  out vec2 vUv;
  out vec3 vData;
  out float vHeavy;

  void main() {
    float size = max(aPuff.z, 3.0 * tilesPerPixel);
    vUv = uv;
    vData = vec3(aPuff.w, aMark.x, size);
    vHeavy = aMark.y;
    gl_Position = placed(aPuff.xy, position.xy * size);
  }
`;

const puffFragment = /* glsl */ `
  uniform float moving;
  uniform float rich;
  in vec2 vUv;
  in vec3 vData;
  in float vHeavy;
  layout(location = 0) out highp vec4 outColor;
  ${noise}

  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float d = length(q);
    float age = vData.x;
    if (moving < 0.5) {
      // Held still: a small dot that only fades, a dotted line along the arc.
      float a = smoothstep(1.0, 0.6, d) * (1.0 - age) * 0.5;
      outColor = vec4(vec3(0.92, 0.92, 0.94) * a, a);
      return;
    }
    float n = rich > 0.5 ? fbm3(vUv * 4.0 + vData.y * 10.0 + vec2(0.0, age * 0.6)) : 0.5;
    float s = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.95);
    float fade = pow(1.0 - age, 1.5) * smoothstep(0.0, 0.05, age);
    // Lit from the north-west like the relief; the heavy missile's smoke is darker.
    float lit = clamp(0.55 + dot(q, vec2(-0.62, 0.78)) * 0.45, 0.0, 1.0);
    vec3 smoke = mix(vec3(0.46, 0.46, 0.49), vec3(0.95, 0.95, 0.97), lit);
    smoke = mix(smoke, vec3(0.20, 0.17, 0.15), vHeavy * 0.55);
    float a = s * fade * 0.62;
    float hot = exp(-age * 16.0) * s * (1.0 - d);
    outColor = vec4(smoke * a + vec3(1.0, 0.58, 0.20) * hot * 1.1, a);
  }
`;

/**
 * The missiles of the flat map, in flight. Fed the marks of every frame
 * (`ships`); a mark that stops arriving leaves its trail to fade. Loaded on
 * demand with the effects, apart from the main bundle.
 */
export class MissileLayer {
  readonly meshes: Three.Mesh<Three.InstancedBufferGeometry, Three.ShaderMaterial>[];
  private readonly missileGeometry: Three.InstancedBufferGeometry;
  private readonly puffGeometry: Three.InstancedBufferGeometry;
  private readonly body = new Float32Array(CAPACITY * 4);
  private readonly ground = new Float32Array(CAPACITY * 4);
  private readonly size = new Float32Array(CAPACITY * 4);
  private readonly owner = new Float32Array(CAPACITY * 4);
  private readonly target = new Float32Array(CAPACITY * 4);
  private readonly puff = new Float32Array(PUFFS * 4);
  private readonly mark = new Float32Array(PUFFS * 2);
  private readonly shared: Record<string, Three.IUniform>;
  private readonly live = new Map<number, Live>();
  private ghosts: Ghost[] = [];
  private pass = 0;
  private moving: boolean;
  private seeded = false;

  constructor(private readonly options: MissileLayerOptions) {
    const [
      Mesh,
      ShaderMaterial,
      InstancedBufferGeometry,
      InstancedBufferAttribute,
      BufferAttribute,
    ] = options.three;
    this.moving = options.moving;
    const square = (): Three.InstancedBufferGeometry => {
      const geometry = new InstancedBufferGeometry();
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
      );
      geometry.instanceCount = 0;
      return geometry;
    };
    const attach = (
      geometry: Three.InstancedBufferGeometry,
      name: string,
      array: Float32Array,
      width: number,
    ): void => {
      const attribute = new InstancedBufferAttribute(array, width);
      attribute.setUsage(DYNAMIC_DRAW);
      geometry.setAttribute(name, attribute);
    };
    this.missileGeometry = square();
    attach(this.missileGeometry, "aBody", this.body, 4);
    attach(this.missileGeometry, "aGround", this.ground, 4);
    attach(this.missileGeometry, "aSize", this.size, 4);
    attach(this.missileGeometry, "aOwner", this.owner, 4);
    attach(this.missileGeometry, "aTarget", this.target, 4);
    this.puffGeometry = square();
    attach(this.puffGeometry, "aPuff", this.puff, 4);
    attach(this.puffGeometry, "aMark", this.mark, 2);

    this.shared = {
      worldWidth: { value: options.map.width },
      cameraX: { value: 0 },
      wrapsX: { value: options.map.wrapsX },
      tilesPerPixel: { value: 1 },
      depth: { value: DEPTH },
      time: { value: 0 },
      moving: { value: options.moving ? 1 : 0 },
      rich: { value: options.rich ? 1 : 0 },
    };
    const make = (
      geometry: Three.InstancedBufferGeometry,
      vertexShader: string,
      fragmentShader: string,
      order: number,
    ): Three.Mesh<Three.InstancedBufferGeometry, Three.ShaderMaterial> => {
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        ...PREMULTIPLIED,
        uniforms: this.shared,
      });
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = order;
      // Everything wraps in the shader, so the CPU-side bounds are meaningless.
      mesh.frustumCulled = false;
      mesh.position.copy(options.anchor);
      options.scene.add(mesh);
      return mesh;
    };
    // Under the structures' plates and over the land: the circle on the target, the shadow, the trail, then the body.
    this.meshes = [
      make(this.missileGeometry, ringVertex, ringFragment, 6),
      ...(options.rich ? [make(this.missileGeometry, shadowVertex, shadowFragment, 6.2)] : []),
      make(this.puffGeometry, puffVertex, puffFragment, 7),
      make(this.missileGeometry, bodyVertex, bodyFragment, 9),
    ];
  }

  /** Whether the player accepts motion. */
  setMotion(moving: boolean): void {
    this.moving = moving;
    (this.shared.moving as Three.IUniform<number>).value = moving ? 1 : 0;
  }

  /** Whether a missile is in flight or a trail is still fading, which keeps frames coming. */
  alive(now: number): boolean {
    return this.live.size > 0 || this.ghosts.some((ghost) => now < ghost.endedAt + lifeOf(ghost));
  }

  /** The missiles of this frame, from the marks of every unit: those that vanished leave a trail. */
  ships(marks: readonly UnitMark[], now: number): void {
    const pass = ++this.pass;
    const { map } = this.options;
    for (const mark of marks) {
      if (mark.id === undefined || (mark.kind !== "missile" && mark.kind !== "heavyMissile"))
        continue;
      const course = courseOf(mark, map);
      const s = mark.flown ?? 0;
      const fix = course ? fixAt(course, s) : undefined;
      const entry = this.live.get(mark.id) ?? ({} as Live);
      entry.course = course;
      entry.s = s;
      entry.x = fix ? fix.x : mark.x + 0.5;
      entry.y = fix ? fix.y : map.height - mark.y - 0.5;
      entry.heading = course ? headingAt(course, s) : -(mark.heading ?? 0);
      entry.heavy = mark.kind === "heavyMissile";
      entry.speed = Math.max(mark.speed ?? 0, MIN_SPEED * blastScale(map));
      entry.rgb = rgbOf(mark.owner ?? mark.color);
      entry.radius = mark.radius ?? 0;
      entry.pass = pass;
      this.live.set(mark.id, entry);
    }
    for (const [id, entry] of this.live) {
      if (entry.pass === pass) continue;
      this.live.delete(id);
      // Before the first frame every missile is a newcomer, and a jump in a replay is no trail.
      if (!this.seeded || !entry.course || entry.s <= 0) continue;
      if (this.ghosts.length >= GHOSTS) this.ghosts.shift();
      this.ghosts.push({
        course: entry.course,
        s: entry.s,
        heavy: entry.heavy,
        speed: entry.speed,
        endedAt: now,
      });
    }
    this.seeded = true;
  }

  /** Follows the clock and the camera, and sets every missile and puff for this frame. */
  update(now: number, cameraX: number, tilesPerPixel: number): void {
    (this.shared.time as Three.IUniform<number>).value = now;
    (this.shared.cameraX as Three.IUniform<number>).value = cameraX;
    (this.shared.tilesPerPixel as Three.IUniform<number>).value = tilesPerPixel;
    this.ghosts = this.ghosts.filter((ghost) => now < ghost.endedAt + lifeOf(ghost));
    const { rich } = this.options;
    const spacing = (rich ? SPACING_PIXELS.rich : SPACING_PIXELS.light) * tilesPerPixel;
    let missiles = 0;
    let puffs = 0;
    const pushTrail = (
      course: Course,
      s: number,
      speed: number,
      heavy: boolean,
      late: number,
    ): void => {
      const kind = heavy ? BODY.heavy : BODY.light;
      const length = Math.min(
        Math.max(kind.tiles, kind.minPixels * tilesPerPixel),
        kind.maxPixels * tilesPerPixel,
      );
      const bodyTiles = length / 1.9;
      const life = heavy ? LIFE.heavy : LIFE.light;
      // Thicker puffs for a heavy missile, a thin dotted line when held still.
      const grown = this.moving ? (heavy ? 1.25 : 1) : 0.16;
      // No more puffs than a trail may have: wider apart when the screen is zoomed in far.
      const step = Math.max(spacing, (speed * life) / TRAIL_PUFFS);
      const first = puffs;
      trailOf(course, s, speed, life, step, late, (puff) => {
        if (puffs >= PUFFS) return;
        const i = puffs++;
        const size = this.moving
          ? bodyTiles * (0.45 + 1.9 * puff.age ** 0.7) * grown
          : bodyTiles * grown;
        this.puff.set([puff.x, puff.y, size, puff.age], i * 4);
        this.mark.set([puff.seed, heavy ? 1 : 0], i * 2);
      });
      // Newest first, drawn last: the oldest smoke lies under the rest.
      for (let a = first, b = puffs - 1; a < b; a++, b--) {
        for (let k = 0; k < 4; k++) swap(this.puff, a * 4 + k, b * 4 + k);
        for (let k = 0; k < 2; k++) swap(this.mark, a * 2 + k, b * 2 + k);
      }
    };
    for (const entry of this.live.values()) {
      if (missiles >= CAPACITY) break;
      const i = missiles++;
      const kind = entry.heavy ? BODY.heavy : BODY.light;
      const { course } = entry;
      const ground = course ? fixAt(course, entry.s) : undefined;
      this.body.set([entry.x, entry.y, entry.heading, ground ? ground.alt : 0], i * 4);
      this.ground.set(
        [
          ground ? ground.gx : entry.x,
          ground ? ground.gy : entry.y,
          course ? groundHeading(course) : entry.heading,
          entry.s,
        ],
        i * 4,
      );
      this.size.set([kind.tiles, kind.minPixels, kind.maxPixels, entry.heavy ? 1 : 0], i * 4);
      this.owner.set([...entry.rgb, entry.radius], i * 4);
      // A missile that does not say where it goes has no circle: a radius of nothing, drawn nowhere.
      if (course) {
        this.target.set([course.x + course.dx, course.y + course.dy, 0, 0], i * 4);
      } else {
        this.owner[i * 4 + 3] = 0;
        this.target.set([-1e6, -1e6, 0, 0], i * 4);
      }
      if (course) pushTrail(course, entry.s, entry.speed, entry.heavy, 0);
    }
    for (const ghost of this.ghosts) {
      pushTrail(ghost.course, ghost.s, ghost.speed, ghost.heavy, now - ghost.endedAt);
    }
    this.missileGeometry.instanceCount = missiles;
    this.puffGeometry.instanceCount = puffs;
    for (const geometry of [this.missileGeometry, this.puffGeometry]) {
      for (const attribute of Object.values(geometry.attributes)) {
        if ("isInstancedBufferAttribute" in attribute) attribute.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.material.dispose();
    }
    this.missileGeometry.dispose();
    this.puffGeometry.dispose();
  }
}

function lifeOf(ghost: { heavy: boolean }): number {
  return ghost.heavy ? LIFE.heavy : LIFE.light;
}

function swap(array: Float32Array, a: number, b: number): void {
  const held = array[a] as number;
  array[a] = array[b] as number;
  array[b] = held;
}

/** A `#RRGGBB` colour as the red, green and blue the shader writes as they are (the screen's own). */
function rgbOf(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}
