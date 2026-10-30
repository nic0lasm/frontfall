import type * as Three from "three";
import type { FalloutZone } from "./renderer.ts";

/** Zones drawn at once; when more are active, the ones that last longest win. */
const CAPACITY = 32;

/** Three.js's `DynamicDrawUsage` and `GLSL3`, which the page need not hand over. */
const DYNAMIC_DRAW = 35048;
const GLSL3 = "300 es";

/** Above the ground and the structures, under the combat effects. */
const DEPTH = 0.3;
const RENDER_ORDER = 5;

/** A zone's end, as the clock of the view shows it, is moved only when the game's own drifts further. */
const RESYNC_SECONDS = 1;

/**
 * What the layer takes from Three.js. The page hands it over rather than the
 * layer importing it, as it does for the combat effects (effects-layer.ts).
 */
export type FalloutThreeParts = readonly [
  Mesh: typeof Three.Mesh,
  ShaderMaterial: typeof Three.ShaderMaterial,
  InstancedBufferGeometry: typeof Three.InstancedBufferGeometry,
  InstancedBufferAttribute: typeof Three.InstancedBufferAttribute,
  BufferAttribute: typeof Three.BufferAttribute,
];

export interface FalloutLayerOptions {
  readonly three: FalloutThreeParts;
  readonly map: { readonly width: number; readonly height: number; readonly wrapsX: boolean };
  /** The ground texture of the territory layer: its alpha tells land from sea (encodeCoast). */
  readonly ground: Three.Texture;
  readonly scene: Three.Object3D;
  readonly anchor: Three.Vector3;
  /** Whether the player accepts motion: held still, the last seconds do not blink. */
  readonly moving: boolean;
  /** A touch screen: the countdown arc is wider. */
  readonly coarse: boolean;
}

interface Active {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly heavy: boolean;
  /** Seconds on the clock of the view. */
  end: number;
  readonly seconds: number;
  /** 1 or -1: the direction of the hatching, which alternates with each zone that appears. */
  readonly slant: 1 | -1;
}

const vertexShader = /* glsl */ `
  uniform float worldWidth;
  uniform float cameraX;
  uniform bool wrapsX;
  uniform float depth;
  // x and y of the centre in tiles with y pointing north, the radius, the end on the clock.
  in vec4 aZone;
  // Duration in seconds, 1 for the heavy missile, 1 or -1 for the direction of the hatching.
  in vec3 aInfo;
  out vec2 vLocal;
  out vec4 vZone;
  out vec3 vInfo;

  void main() {
    float reach = aZone.z + 3.0;
    vec2 local = position.xy * 2.0 * reach;
    vec4 middle = modelMatrix * vec4(aZone.xy, depth, 1.0);
    vec4 world = modelMatrix * vec4(aZone.xy + local, depth, 1.0);
    // The copy of the world closest to the camera, judged by the centre.
    if (wrapsX) world.x += worldWidth * floor((cameraX - middle.x) / worldWidth + 0.5);
    vLocal = local;
    vZone = aZone;
    vInfo = aInfo;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D ground;
  uniform vec2 worldSize;
  uniform bool wrapsX;
  uniform float time;
  uniform float tilesPerPixel;
  uniform float moving;
  uniform float arcWidth;
  in vec2 vLocal;
  in vec4 vZone;
  in vec3 vInfo;
  layout(location = 0) out highp vec4 outColor;

  const float TAU = 6.2831853;
  const vec3 INK = vec3(0.07, 0.08, 0.01);
  const vec3 PAPER = vec3(0.97, 0.95, 0.78);

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

  /** "colour" over "base", both with straight alpha. */
  vec4 over(vec4 base, vec3 colour, float alpha) {
    float a = alpha + base.a * (1.0 - alpha);
    vec3 c = a > 0.0 ? (colour * alpha + base.rgb * base.a * (1.0 - alpha)) / a : base.rgb;
    return vec4(c, a);
  }

  /** Signed distance to an upward triangle of size r, centred on the origin. */
  float triangle(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  void main() {
    float radius = vZone.z;
    float radiusPx = radius / tilesPerPixel;
    float secondsLeft = vZone.w - time;
    if (secondsLeft <= 0.0) discard;
    float duration = vInfo.x;
    float left = clamp(secondsLeft / duration, 0.0, 1.0);

    // Pixels inside the edge of the zone, negative outside.
    float edge = (radius - length(vLocal)) / tilesPerPixel;
    // The zone dissolves over its last 2.5 s; it blinks over the last 4 s unless motion is held still.
    float fade = smoothstep(0.0, 2.5, secondsLeft);
    float blink = secondsLeft < 4.0 ? 1.0 - 0.3 * moving * step(0.5, fract(time * 2.0)) : 1.0;

    // Land only: the ground's alpha is above one half on land (encodeCoast).
    float tileX = vZone.x + vLocal.x;
    float northY = vZone.y + vLocal.y;
    float u = wrapsX ? fract(tileX / worldSize.x) : tileX / worldSize.x;
    float landAlpha = texture(ground, vec2(u, 1.0 - northY / worldSize.y)).a;
    float land = smoothstep(0.46, 0.54, landAlpha);

    vec4 c = vec4(0.0);

    // The zone itself: an olive wash that clears with time, under hatching at 45 degrees.
    // The next zone over it hatches the other way, so that an overlap reads as a grid.
    float inside = smoothstep(-0.5, 0.5, edge);
    float hatchAxis = dot(vLocal, normalize(vec2(1.0, vInfo.z))) / tilesPerPixel;
    float line = 1.0 - smoothstep(0.7, 1.4, abs(fract(hatchAxis / 7.0) - 0.5) * 7.0);
    float body = 0.45 + 0.55 * left;
    c = over(c, lin(vec3(0.34, 0.38, 0.1)), 0.3 * body * inside * land);
    c = over(c, lin(vec3(0.16, 0.18, 0.03)), 0.5 * body * line * inside * land);

    // The outline in dashes: light inside a dark frame, so it shows on dark land and on pastel.
    float angle = fract(atan(vLocal.x, vLocal.y) / TAU);
    float dashes = step(0.5, fract(angle * radiusPx * TAU / 9.0));
    float frame = 1.0 - smoothstep(1.4, 2.4, abs(edge - 2.2));
    float light = 1.0 - smoothstep(0.5, 1.2, abs(edge - 1.0));
    c = over(c, lin(INK), 0.75 * frame * dashes * land);
    c = over(c, lin(PAPER), light * dashes * land);

    // The countdown: an arc that shrinks clockwise from the top, on a dotted rail of the time gone.
    float ring = arcWidth * 0.5 + 5.0;
    float ringRadius = radiusPx - ring;
    float gone = 1.0 - left;
    float band = abs(edge - ring);
    float casing = 1.0 - smoothstep(arcWidth * 0.5 + 1.0, arcWidth * 0.5 + 2.2, band);
    float arc = 1.0 - smoothstep(arcWidth * 0.5 - 0.6, arcWidth * 0.5 + 0.4, band);
    float remaining = step(gone, angle);
    float dots = step(0.5, fract(angle * ringRadius * TAU / 7.0));
    float rail = (1.0 - smoothstep(0.7, 1.5, band)) * (1.0 - remaining) * dots;
    vec3 hot = left < 0.34 ? vec3(1.0, 0.54, 0.12) : vec3(1.0, 0.82, 0.22);
    float showArc = step(14.0, radiusPx) * fade;
    c = over(c, lin(INK), 0.8 * casing * remaining * showArc);
    c = over(c, lin(INK), 0.6 * rail * showArc);
    c = over(c, lin(hot), arc * remaining * showArc);
    // A mark every 10 s of the whole duration: three for 30 s, nine for 90 s.
    float marks = 0.0;
    for (int k = 1; k <= 9; k++) {
      if (float(k) * 10.0 > duration + 0.01) break;
      float at = 1.0 - float(k) * 10.0 / duration;
      float away = abs(fract(angle - at + 0.5) - 0.5) * TAU * ringRadius;
      marks = max(marks, 1.0 - smoothstep(0.6, 1.4, away));
    }
    float markBand = 1.0 - smoothstep(arcWidth * 0.5 + 2.0, arcWidth * 0.5 + 3.0, band);
    c = over(c, lin(PAPER), 0.95 * marks * markBand * showArc * remaining);

    // The danger glyph, a triangle with a bar and a point, 11 to 30 px.
    float g = clamp(radiusPx * 0.26, 11.0, 30.0);
    vec2 p = vLocal / tilesPerPixel;
    float tri = triangle(p, g * 0.7);
    float showGlyph = step(8.0, radiusPx) * fade;
    float inner = step(tri, -1.2);
    float bar = (1.0 - smoothstep(0.0, 0.8, abs(p.x) - g * 0.07)) * step(-g * 0.12, p.y) * step(p.y, g * 0.3);
    float point = 1.0 - smoothstep(g * 0.07, g * 0.07 + 0.8, length(p - vec2(0.0, -g * 0.22)));
    c = over(c, lin(INK), (1.0 - smoothstep(0.0, 1.0, tri)) * showGlyph);
    c = over(c, lin(vec3(1.0, 0.82, 0.22)), inner * showGlyph);
    c = over(c, lin(INK), max(bar, point) * inner * showGlyph);

    float a = c.a * fade * blink;
    if (a <= 0.004) discard;
    outColor = linearToOutputTexel(vec4(c.rgb, a));
  }
`;

/**
 * The zones of fallout (R-UNIT-06) of the flat map: one instanced quad per
 * zone, cut to the land by the ground's coast, drawn as an olive wash with
 * hatching, a dashed outline, a countdown arc that runs down clockwise with
 * a mark every 10 s, and a danger glyph. What is read is the shape (angle,
 * dashes, hatching), never the hue alone. Loaded on demand, apart from the
 * main bundle.
 */
export class FalloutLayer {
  readonly mesh: Three.Mesh<Three.InstancedBufferGeometry, Three.ShaderMaterial>;
  private readonly zone = new Float32Array(CAPACITY * 4);
  private readonly info = new Float32Array(CAPACITY * 3);
  private readonly attributes: Three.InstancedBufferAttribute[];
  private active: Active[] = [];
  private liveUntil = 0;
  private started = 0;

  constructor(private readonly options: FalloutLayerOptions) {
    const [
      Mesh,
      ShaderMaterial,
      InstancedBufferGeometry,
      InstancedBufferAttribute,
      BufferAttribute,
    ] = options.three;
    const geometry = new InstancedBufferGeometry();
    // A unit square centred on the origin.
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    const instanced = (name: string, array: Float32Array, size: number): void => {
      const attribute = new InstancedBufferAttribute(array, size);
      attribute.setUsage(DYNAMIC_DRAW);
      geometry.setAttribute(name, attribute);
    };
    instanced("aZone", this.zone, 4);
    instanced("aInfo", this.info, 3);
    this.attributes = ["aZone", "aInfo"].map(
      (name) => geometry.getAttribute(name) as Three.InstancedBufferAttribute,
    );
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        worldWidth: { value: options.map.width },
        worldSize: { value: { x: options.map.width, y: options.map.height } },
        cameraX: { value: 0 },
        wrapsX: { value: options.map.wrapsX },
        time: { value: 0 },
        tilesPerPixel: { value: 1 },
        depth: { value: DEPTH },
        ground: { value: options.ground },
        moving: { value: options.moving ? 1 : 0 },
        arcWidth: { value: options.coarse ? 6 : 4 },
      },
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = RENDER_ORDER;
    // Zones wrap in the shader, so the CPU-side bounds are meaningless.
    this.mesh.frustumCulled = false;
    this.mesh.position.copy(options.anchor);
    options.scene.add(this.mesh);
  }

  /** Whether the player accepts motion; held still, the last seconds do not blink. */
  setMotion(moving: boolean): void {
    (this.mesh.material.uniforms.moving as Three.IUniform<number>).value = moving ? 1 : 0;
  }

  /**
   * The zones now in force, replacing the previous ones, with `now` on the
   * clock of the view. A zone already shown keeps its own end unless the
   * game's drifts away from it. Returns whether anything changed.
   */
  set(zones: readonly FalloutZone[], now: number): boolean {
    const before = this.active;
    const next: Active[] = zones.map((z) => {
      const end = now + z.secondsLeft;
      const kept = before.find(
        (a) => a.x === z.x && a.y === z.y && a.radius === z.radius && a.heavy === z.heavy,
      );
      if (kept && Math.abs(kept.end - end) <= RESYNC_SECONDS) return kept;
      const slant = this.started++ % 2 === 0 ? 1 : -1;
      return { x: z.x, y: z.y, radius: z.radius, heavy: z.heavy, end, seconds: z.seconds, slant };
    });
    // Longest-lasting first: they are the ones kept when there are too many.
    next.sort((a, b) => b.end - a.end);
    if (next.length > CAPACITY) next.length = CAPACITY;
    if (next.length === before.length && next.every((a, i) => a === before[i])) return false;
    this.active = next;
    const height = this.options.map.height;
    next.forEach((a, i) => {
      // Tile centres, y pointing north.
      this.zone.set([a.x + 0.5, height - (a.y + 0.5), a.radius, a.end], i * 4);
      this.info.set([a.seconds, a.heavy ? 1 : 0, a.slant], i * 3);
    });
    this.liveUntil = next.reduce((latest, a) => Math.max(latest, a.end), 0);
    for (const attribute of this.attributes) attribute.needsUpdate = true;
    this.mesh.geometry.instanceCount = next.length;
    return true;
  }

  /** Whether any zone is still running at `now`: the countdown needs frames. */
  alive(now: number): boolean {
    return this.active.length > 0 && now < this.liveUntil;
  }

  /** Follows the clock and the camera. */
  update(now: number, cameraX: number, tilesPerPixel: number): void {
    const { uniforms } = this.mesh.material;
    (uniforms.time as Three.IUniform<number>).value = now;
    (uniforms.cameraX as Three.IUniform<number>).value = cameraX;
    (uniforms.tilesPerPixel as Three.IUniform<number>).value = tilesPerPixel;
  }

  /** Bytes of instance data on the GPU. */
  gpuBytes(): number {
    return CAPACITY * (4 + 3) * 4;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
