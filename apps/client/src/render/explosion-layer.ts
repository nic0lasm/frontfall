import type * as Three from "three";
import { COMPOSITE_FRAGMENT, EXPLOSION_FRAGMENT, EXPLOSION_VERTEX } from "./explosion-shader.ts";

/** Explosions drawn volumetrically at once; the next one is left to the plain marks. */
export const EXPLOSION_SLOTS = 4;

/** Half the side of the quad, in blast radii: the shock wave and the smoke shadow reach this far. */
const REACH = 2.55;
/** Seconds a blast lasts: the smoke thins out and the last clods settle. */
const LIFE = { light: 2.1, heavy: 3 };
/** A blast wider than this many device pixels of radius is drawn at half resolution. */
const HALF_RESOLUTION_ABOVE = 120;
/** Longest side of a half-resolution target, in texels. */
const TARGET_MAX = 1024;
/** Smallest radius on screen in CSS pixels, however far the view is zoomed out. */
const MIN_PIXELS = { light: 26, heavy: 44 };
/** Toward the light on the sketches' screen, y pointing south: the relief's north-west light. */
const LIGHT = [-0.62, -0.78];

/** Three.js's `CustomBlending`, `AddEquation`, `OneFactor`, `OneMinusSrcAlphaFactor`, `DoubleSide` and `LinearFilter`. */
const CUSTOM_BLENDING = 5;
const ADD_EQUATION = 100;
const ONE = 201;
const ONE_MINUS_SRC_ALPHA = 205;
const DOUBLE_SIDE = 2;
const LINEAR_FILTER = 1006;

/** What the explosions take from Three.js; the page hands it over (see effects-layer.ts). */
export type ExplosionParts = readonly [
  Mesh: typeof Three.Mesh,
  ShaderMaterial: typeof Three.ShaderMaterial,
  BufferGeometry: typeof Three.BufferGeometry,
  BufferAttribute: typeof Three.BufferAttribute,
  Scene: typeof Three.Scene,
  OrthographicCamera: typeof Three.OrthographicCamera,
  WebGLRenderTarget: typeof Three.WebGLRenderTarget,
  Color: typeof Three.Color,
];

export interface ExplosionOptions {
  readonly parts: ExplosionParts;
  readonly renderer: Three.WebGLRenderer;
  readonly scene: Three.Object3D;
  readonly anchor: Three.Vector3;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly wrapsX: boolean;
  /** The light picture: no sparks, embers, clods or smoke shadow, and a smaller target. */
  readonly saver: boolean;
}

type Quad = Three.Mesh<Three.BufferGeometry, Three.ShaderMaterial>;

/** One blast: the quad that draws it, and what it needs to be drawn through a half-resolution target. */
interface Slot {
  /** On the map, when the blast is drawn at screen resolution. */
  readonly direct: Quad;
  /** In `offscreen`, when it is drawn at half resolution. */
  readonly inTarget: Quad;
  /** On the map, laying the target over it. */
  readonly composite: Quad;
  readonly offscreen: Three.Scene;
  /** The uniforms of the blast's shader and of the one that lays the target over the map. */
  readonly time: Three.IUniform<number>;
  readonly radiusPixels: Three.IUniform<number>;
  readonly heavyUniform: Three.IUniform<number>;
  readonly seedUniform: Three.IUniform<number>;
  readonly texture: Three.IUniform<Three.Texture | null>;
  target: Three.WebGLRenderTarget | undefined;
  birth: number;
  x: number;
  y: number;
  radius: number;
  heavy: boolean;
  seed: number;
  active: boolean;
}

/**
 * The volumetric explosions of the flat map (art-direction.md, Effects). A
 * handful of quads of their own, because a blast covers a large part of a
 * zoomed-in screen and costs far more per pixel than a mark: at most four are
 * alive at once, a wide one is drawn into a half-resolution target, and the
 * light picture leaves out the finest details. Loaded on demand with the rest
 * of the effects, apart from the main bundle.
 */
export class ExplosionLayer {
  private readonly slots: Slot[] = [];
  private readonly camera: Three.OrthographicCamera;
  private readonly clear: Three.Color;
  private next = 0;
  private liveUntil = 0;
  private bytes = 0;

  constructor(private readonly options: ExplosionOptions) {
    const [Mesh, ShaderMaterial, BufferGeometry, BufferAttribute, Scene, OrthographicCamera] =
      options.parts;
    const Color = options.parts[7];
    this.clear = new Color();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
    const geometry = new BufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    const quad = (material: Three.ShaderMaterial, scene: Three.Object3D): Quad => {
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    const material = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
      new ShaderMaterial({
        vertexShader: EXPLOSION_VERTEX,
        fragmentShader,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DOUBLE_SIDE,
        // Premultiplied: the fire adds light, the smoke covers.
        blending: CUSTOM_BLENDING,
        blendEquation: ADD_EQUATION,
        blendSrc: ONE,
        blendDst: ONE_MINUS_SRC_ALPHA,
      });
    for (let i = 0; i < EXPLOSION_SLOTS; i++) {
      const time = { value: -1 };
      const radiusPixels = { value: 100 };
      const heavyUniform = { value: 0 };
      const seedUniform = { value: 0 };
      const texture = { value: null };
      const shape = material(EXPLOSION_FRAGMENT, {
        uT: time,
        uR: radiusPixels,
        uHeavy: heavyUniform,
        uSeed: seedUniform,
        uAir: { value: 0 },
        uLight: { value: LIGHT },
        uQuality: { value: options.saver ? 0 : 1 },
      });
      const offscreen = new Scene();
      const inTarget = quad(shape, offscreen);
      inTarget.scale.set(2, 2, 1);
      inTarget.visible = true;
      this.slots.push({
        direct: quad(shape, options.scene),
        inTarget,
        composite: quad(material(COMPOSITE_FRAGMENT, { uTexture: texture }), options.scene),
        offscreen,
        time,
        radiusPixels,
        heavyUniform,
        seedUniform,
        texture,
        target: undefined,
        birth: 0,
        x: 0,
        y: 0,
        radius: 1,
        heavy: false,
        seed: 0,
        active: false,
      });
    }
  }

  /** Starts a blast at tile (`x`, `y`), y counted from the north, of `radius` tiles; `false` when all four are playing. */
  start(x: number, y: number, radius: number, heavy: boolean, now: number): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[(this.next + i) % this.slots.length] as Slot;
      if (this.running(slot, now)) continue;
      this.next = (this.next + i + 1) % this.slots.length;
      slot.active = true;
      slot.birth = now;
      slot.x = x;
      slot.y = this.options.mapHeight - y;
      slot.radius = radius;
      slot.heavy = heavy;
      // Two blasts of a game should not look alike; the same blast on two screens does.
      slot.seed = (Math.abs(Math.floor(x) * 7 + Math.floor(y) * 13) % 97) / 10 + 0.4;
      this.liveUntil = Math.max(this.liveUntil, now + (heavy ? LIFE.heavy : LIFE.light));
      return true;
    }
    return false;
  }

  /** Whether a blast is still playing at `now`, which keeps frames coming. */
  alive(now: number): boolean {
    return now < this.liveUntil;
  }

  /** Follows the clock and the camera, and draws the half-resolution blasts into their targets. */
  update(now: number, cameraX: number, tilesPerPixel: number): void {
    const { renderer, anchor, mapWidth, wrapsX } = this.options;
    const ratio = renderer.getPixelRatio();
    let restore: { target: Three.WebGLRenderTarget | null; alpha: number } | undefined;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (!this.running(slot, now)) {
        slot.active = false;
        slot.direct.visible = false;
        slot.composite.visible = false;
        continue;
      }
      const radius = Math.max(
        slot.radius,
        MIN_PIXELS[slot.heavy ? "heavy" : "light"] * tilesPerPixel,
      );
      const side = 2 * REACH * radius;
      const radiusPixels = (radius / tilesPerPixel) * ratio;
      const half = radiusPixels > HALF_RESOLUTION_ABOVE;
      // The copy of the world nearest the camera, judged by the centre.
      let x = slot.x;
      if (wrapsX) x += mapWidth * Math.floor((cameraX - (anchor.x + x)) / mapWidth + 0.5);
      slot.time.value = now - slot.birth;
      slot.heavyUniform.value = slot.heavy ? 1 : 0;
      slot.seedUniform.value = slot.seed;
      const placed = half ? slot.composite : slot.direct;
      placed.position.set(anchor.x + x, anchor.y + slot.y, anchor.z);
      placed.scale.set(side, side, 1);
      slot.direct.visible = !half;
      slot.composite.visible = half;
      if (!half) {
        slot.radiusPixels.value = Math.max(2, radiusPixels);
        continue;
      }
      const cap = this.options.saver ? TARGET_MAX / 2 : TARGET_MAX;
      const texels = Math.min(cap, Math.ceil(radiusPixels * REACH));
      const target = this.targetFor(slot, texels);
      // The radius in texels, by which the shader keeps its finest strokes at least a texel wide.
      slot.radiusPixels.value = target.width / (2 * REACH);
      if (!restore) {
        restore = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha() };
        renderer.getClearColor(this.clear);
      }
      slot.texture.value = target.texture;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(slot.offscreen, this.camera);
    }
    if (restore) {
      renderer.setRenderTarget(restore.target);
      renderer.setClearColor(this.clear, restore.alpha);
    }
  }

  /** The target of `slot`, at least `texels` a side; one is kept, so that a blast does not allocate every frame. */
  private targetFor(slot: Slot, texels: number): Three.WebGLRenderTarget {
    if (slot.target && slot.target.width >= texels) return slot.target;
    const WebGLRenderTarget = this.options.parts[6];
    if (slot.target) {
      this.bytes -= slot.target.width * slot.target.height * 4;
      slot.target.dispose();
    }
    slot.target = new WebGLRenderTarget(texels, texels, {
      depthBuffer: false,
      minFilter: LINEAR_FILTER,
      magFilter: LINEAR_FILTER,
    });
    this.bytes += texels * texels * 4;
    return slot.target;
  }

  private running(slot: Slot, now: number): boolean {
    return slot.active && now - slot.birth < (slot.heavy ? LIFE.heavy : LIFE.light);
  }

  /** Bytes of render targets on the GPU. */
  gpuBytes(): number {
    return this.bytes;
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.target?.dispose();
      slot.direct.material.dispose();
      slot.composite.material.dispose();
    }
    this.slots[0]?.direct.geometry.dispose();
  }
}
