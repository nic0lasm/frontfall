import type * as Three from "three";
import type { CameraView } from "./camera.ts";
import { EffectTracker, type Particle } from "./effects-track.ts";
import type { UnitMark } from "./renderer.ts";

/** Marks alive at once; the oldest is overwritten when more are asked for. */
const CAPACITY = 768;

/** Three.js's `DynamicDrawUsage` and `GLSL3`, which the page need not hand over. */
const DYNAMIC_DRAW = 35048;
const GLSL3 = "300 es";

/** Height above the map: over units and structures. */
const DEPTH = 0.45;

/**
 * What the layer takes from Three.js. The page hands it over rather than the
 * layer importing it: a lazy chunk of its own that imports Three.js makes the
 * bundler split the library off the main bundle, at a cost to the first visit.
 */
export type ThreeParts = readonly [
  Mesh: typeof Three.Mesh,
  ShaderMaterial: typeof Three.ShaderMaterial,
  InstancedBufferGeometry: typeof Three.InstancedBufferGeometry,
  InstancedBufferAttribute: typeof Three.InstancedBufferAttribute,
  BufferAttribute: typeof Three.BufferAttribute,
];

export interface EffectsLayerOptions {
  readonly three: ThreeParts;
  /** The map the effects are drawn on; its owners array is read in place. */
  readonly map: {
    readonly width: number;
    readonly height: number;
    readonly wrapsX: boolean;
    readonly owners: Uint16Array;
  };
  /** The scene to join, and the position every layer of it shares. */
  readonly scene: Three.Object3D;
  readonly anchor: Three.Vector3;
  /** Whether the player accepts motion. */
  readonly moving: boolean;
}

const vertexShader = /* glsl */ `
  uniform float worldWidth;
  uniform float cameraX;
  uniform bool wrapsX;
  uniform float time;
  uniform float tilesPerPixel;
  uniform float depth;
  // x, y of the centre in tiles with y pointing north, then the drift per second.
  in vec4 aPlace;
  // Birth, life, diameter at birth, diameter at death.
  in vec4 aLife;
  in vec4 aColor;
  // 0 for a disc, 1 for a ring, then the smallest diameter on screen in pixels.
  in vec2 aShape;
  out vec2 vUv;
  out vec4 vColor;
  out float vShape;
  out float vT;

  void main() {
    float age = time - aLife.x;
    float t = age / aLife.y;
    if (age < 0.0 || t > 1.0) {
      // Not alive: a point outside the clip volume, so that nothing is drawn.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float size = max(mix(aLife.z, aLife.w, t), aShape.y * tilesPerPixel);
    vec2 center = aPlace.xy + aPlace.zw * age;
    vec4 middle = modelMatrix * vec4(center, depth, 1.0);
    vec4 world = modelMatrix * vec4(center + position.xy * size, depth, 1.0);
    // The copy of the world closest to the camera, judged by the centre.
    if (wrapsX) world.x += worldWidth * floor((cameraX - middle.x) / worldWidth + 0.5);
    vUv = uv;
    vT = t;
    vShape = aShape.x;
    vColor = vec4(aColor.rgb, aColor.a * smoothstep(0.0, 0.08, t) * pow(1.0 - t, 1.3));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  in vec2 vUv;
  in vec4 vColor;
  in float vShape;
  in float vT;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float a;
    if (vShape > 0.5) {
      float thin = mix(0.24, 0.07, vT);
      a = smoothstep(1.0, 0.9, r) * smoothstep(1.0 - thin - 0.14, 1.0 - thin, r);
    } else {
      a = smoothstep(1.0, 0.4, r);
    }
    if (a <= 0.004) discard;
    outColor = linearToOutputTexel(vec4(vColor.rgb, vColor.a * a));
  }
`;

/**
 * The combat effects of the flat map, in one instanced draw call: every mark
 * is a quad whose position, size and fade the vertex shader works out from the
 * time, so a frame costs the GPU a draw and the CPU nothing but the marks
 * started since the last one. Loaded on demand, apart from the main bundle.
 */
export class EffectsLayer {
  readonly mesh: Three.Mesh<Three.InstancedBufferGeometry, Three.ShaderMaterial>;
  private readonly place = new Float32Array(CAPACITY * 4);
  private readonly life = new Float32Array(CAPACITY * 4);
  private readonly color = new Float32Array(CAPACITY * 4);
  private readonly shape = new Float32Array(CAPACITY * 2);
  private readonly attributes: Three.InstancedBufferAttribute[];
  private readonly tracker: EffectTracker;
  private next = 0;
  private used = 0;
  private dirty = false;
  private liveUntil = 0;

  constructor(private readonly options: EffectsLayerOptions) {
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
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    const instanced = (name: string, array: Float32Array, size: number): void => {
      const attribute = new InstancedBufferAttribute(array, size);
      attribute.setUsage(DYNAMIC_DRAW);
      geometry.setAttribute(name, attribute);
    };
    instanced("aPlace", this.place, 4);
    instanced("aLife", this.life, 4);
    instanced("aColor", this.color, 4);
    instanced("aShape", this.shape, 2);
    this.attributes = ["aPlace", "aLife", "aColor", "aShape"].map(
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
        cameraX: { value: 0 },
        wrapsX: { value: options.map.wrapsX },
        time: { value: 0 },
        tilesPerPixel: { value: 1 },
        depth: { value: DEPTH },
      },
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = 10;
    // Marks wrap in the shader, so the CPU-side bounds are meaningless.
    this.mesh.frustumCulled = false;
    this.mesh.position.copy(options.anchor);
    options.scene.add(this.mesh);
    this.tracker = new EffectTracker(
      (particle) => {
        this.spawn(particle);
      },
      {
        width: options.map.width,
        height: options.map.height,
        wrapsX: options.map.wrapsX,
      },
    );
  }

  /** Whether the player accepts motion; held still, only trails and fading marks remain. */
  setMotion(moving: boolean): void {
    this.tracker.setMotion(moving);
  }

  /** Ships, trade ships and missiles of this frame, to start the effects of those that came or went. */
  ships(marks: readonly UnitMark[], now: number): void {
    this.tracker.ships(marks, now);
  }

  /** Tiles that just changed hands: the front moving. */
  changed(tiles: ArrayLike<number>, now: number): void {
    this.tracker.fronts(tiles, this.options.map.owners, now);
  }

  /** Starts one mark, over the oldest if the buffer is full. */
  spawn(particle: Particle): void {
    const i = this.next;
    this.next = (this.next + 1) % CAPACITY;
    this.used = Math.min(CAPACITY, this.used + 1);
    this.place.set(
      [particle.x, this.options.map.height - particle.y, particle.dx, -particle.dy],
      i * 4,
    );
    this.life.set([particle.birth, particle.life, particle.size0, particle.size1], i * 4);
    this.color.set([...linear(particle.color), particle.alpha], i * 4);
    this.shape.set([particle.shape === "ring" ? 1 : 0, particle.minPixels], i * 2);
    this.liveUntil = Math.max(this.liveUntil, particle.birth + particle.life);
    this.dirty = true;
  }

  /** Whether any mark is still alive at `now`, which keeps frames coming. */
  alive(now: number): boolean {
    return now < this.liveUntil;
  }

  /** Follows the clock and the camera, and uploads the marks started since the last frame. */
  update(now: number, cameraX: number, view: CameraView, tilesPerPixel: number): void {
    const { uniforms } = this.mesh.material;
    (uniforms.time as Three.IUniform<number>).value = now;
    (uniforms.cameraX as Three.IUniform<number>).value = cameraX;
    (uniforms.tilesPerPixel as Three.IUniform<number>).value = tilesPerPixel;
    this.tracker.setView(view, tilesPerPixel);
    if (!this.dirty) return;
    this.dirty = false;
    for (const attribute of this.attributes) attribute.needsUpdate = true;
    this.mesh.geometry.instanceCount = this.used;
  }

  /** Bytes of instance data on the GPU. */
  gpuBytes(): number {
    return CAPACITY * (4 + 4 + 4 + 2) * 4;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** A `#RRGGBB` colour as the linear red, green and blue the shader writes out again as sRGB. */
function linear(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number): number => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(16), channel(8), channel(0)];
}
