import * as THREE from "three";

/**
 * The game pieces of the flat map (docs/art-direction.md, pictograms): a token
 * plate in the owner's colour with a white glyph, drawn once into a small atlas
 * when the game starts and sampled by one instanced quad per kind. Kept out of
 * the first visit: the page loads it while the menu is open.
 */

/** A glyph on the 24-unit grid: solid shapes, then cut-outs, then the one warm accent. */
interface Glyph {
  readonly solid: string;
  readonly cut?: string;
  readonly accent?: string;
  /** Turned this many degrees around the centre of the plate. */
  readonly turn?: number;
}

/**
 * One silhouette each, meant to read at 16 px: details are cut out of the
 * shape and at least two units wide, never hairlines.
 */
const GLYPHS = {
  city: {
    solid: "M3 20.5V12h5.5v8.5zM9.2 20.5V3.5h6.6v17zM16.8 20.5V8.5h4.4v12z",
    cut: "M10.3 6.5h1.7v2.1h-1.7zM13 6.5h1.7v2.1H13zM10.3 10.7h1.7v2.1h-1.7zM13 10.7h1.7v2.1H13zM10.3 14.9h1.7V17h-1.7zM13 14.9h1.7V17H13zM18 11h2v2h-2zM18 15h2v2h-2zM4.7 14.5h2.1v2.2H4.7z",
  },
  palace: {
    solid:
      "M6 20.5v-7h1.6C8 9.5 9.7 7 12 5.8c2.3 1.2 4 3.7 4.4 7.7H18v7zM3 20.5V11l1.5-3L6 11v9.5zM18 20.5V11l1.5-3L21 11v9.5zM11.4 1.8h1.2v4h-1.2z",
    cut: "M10.6 20.5v-3.6a1.4 1.4 0 0 1 2.8 0v3.6zM8.1 14.6h1.7v2.6H8.1zM14.2 14.6h1.7v2.6h-1.7zM4.2 13h1.2v2.4H4.2zM18.6 13h1.2v2.4h-1.2z",
    accent: "M12.6 1.8l4.2 1.4-4.2 1.4z",
  },
  /** R-CAP-01: a crown, larger on the map than any building. */
  capital: {
    solid: "M3 17.2 2.2 6.8l5.3 4.4L12 3.6l4.5 7.6 5.3-4.4-.8 10.4zM3 18.6h18v2.6H3z",
    cut: "M10.7 12.6a1.3 1.3 0 1 1 2.6 0 1.3 1.3 0 0 1-2.6 0z",
    accent: "M12 .8l1.3 1.6L12 4 10.7 2.4z",
  },
  /** R-LAND-01: a monument's front, a pediment on three columns, for the landmarks of a city map. */
  landmark: {
    solid:
      "M12 2.8 21.5 8.6h-19zM3.5 9.8h17v1.9h-17zM5 12.8h2.6v5.4H5zM10.7 12.8h2.6v5.4h-2.6zM16.4 12.8H19v5.4h-2.6zM2.5 19.2h19v2.1h-19z",
    accent: "M12 4.6a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
  },
  fort: {
    solid: "M3.5 20.5V5h4.2v3h2.4V5h3.8v3h2.4V5h4.2v15.5z",
    cut: "M9.9 20.5v-4.6a2.1 2.1 0 0 1 4.2 0v4.6zM11.2 9.8h1.6v2.8h-1.6z",
  },
  port: {
    solid:
      "M12 2.7a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4zM10.9 7.5h2.2v10.1h-2.2zM7.5 9.2h9v2.1h-9zM3 11.5h3.4a5.6 5.6 0 0 0 11.2 0H21a9 9 0 0 1-18 0z",
    cut: "M12 4.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z",
  },
  silo: {
    solid: "M5.5 20.5V11L8 8.5h8l2.5 2.5v9.5zM12 1.8l3 6.7H9z",
    cut: "M7.5 13h9v1.8h-9zM7.5 17h9v1.8h-9z",
  },
  airDefense: {
    solid: "M12 2.5l8 3v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10v-6z",
    cut: "M12 7l4.6 5.5h-3.1V17h-3v-4.5H7.4z",
  },
  transport: {
    solid: "M3 16h18l-3.5 4.5h-11zM11.3 3h1.4v13h-1.4zM13.7 4.5 20.5 14.5h-6.8zM10.3 7 4 14.5h6.3z",
  },
  trade: {
    solid:
      "M2.5 16.5h19L19 20.5H5zM3.3 11.4h4.4v3.9H3.3zM9 11.4h4.4v3.9H9zM14.7 11.4h4.4v3.9h-4.4zM5.9 6.6h4.4v3.8H5.9zM11.6 6.6H16v3.8h-4.4z",
  },
  warship: {
    solid:
      "M2.5 15.5h17l2.5 2L19 20.5H6zM7.8 11.3h8.4v4.2H7.8zM10.2 8h3.6v3.3h-3.6zM11.4 3.5h1.2V8h-1.2zM13.2 9.4l7.5-1.9.5 1.8-7.5 2z",
    cut: "M6.5 17h2v1.7h-2zM10.5 17h2v1.7h-2zM14.5 17h2v1.7h-2z",
  },
  missile: {
    solid:
      "M12 1.8C14.6 5 15.2 9 15.2 13v4H8.8v-4C8.8 9 9.4 5 12 1.8zM8.8 13.5 5.2 18.5l3.6-1zM15.2 13.5l3.6 5-3.6-1z",
    cut: "M12 6.8a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z",
    accent: "M10.4 17.4h3.2L12 22.4z",
    turn: 45,
  },
  heavyMissile: {
    solid:
      "M12 1C15.2 4.5 16.6 8.5 16.6 13v4.6H7.4V13C7.4 8.5 8.8 4.5 12 1zM7.4 13.5 3.8 19.5l3.6-1.5zM16.6 13.5l3.6 6-3.6-1.5z",
    cut: "M8 11h8v1.5H8zM8 14.2h8v1.5H8z",
    accent: "M9.6 17.8h4.8L12 22.6z",
    turn: 45,
  },
} as const satisfies Record<string, Glyph>;

export type PieceKind = keyof typeof GLYPHS;

/** Position of each kind in the atlas, in reading order. */
export const PIECE_KINDS = Object.keys(GLYPHS) as readonly PieceKind[];

const COLS = 4;
const ROWS = Math.ceil(PIECE_KINDS.length / COLS);
/** Pixels per cell, and the empty margin that keeps neighbours from bleeding into each other's mipmaps. */
const CELL = 96;
const PAD = 6;
const SIDE = CELL - 2 * PAD;
const GRID = 24;

/** Rounded square of the plate, corner radius 6 of 24 (art direction, rule 4). */
function plate(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const r = (6 / GRID) * SIDE;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + SIDE, y, x + SIDE, y + SIDE, r);
  ctx.arcTo(x + SIDE, y + SIDE, x, y + SIDE, r);
  ctx.arcTo(x, y + SIDE, x, y, r);
  ctx.arcTo(x, y, x + SIDE, y, r);
  ctx.closePath();
}

type Pass = (ctx: CanvasRenderingContext2D, kind: PieceKind, x: number, y: number) => void;

/** Draws every cell with `pass` on a clear canvas and returns the pixels. */
function paint(ctx: CanvasRenderingContext2D, pass: Pass): Uint8ClampedArray {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  PIECE_KINDS.forEach((kind, i) => {
    ctx.save();
    pass(ctx, kind, (i % COLS) * CELL + PAD, Math.floor(i / COLS) * CELL + PAD);
    ctx.restore();
  });
  return ctx.getImageData(0, 0, width, height).data;
}

/** Puts the 24-unit grid on the plate at (x, y), turned as the glyph asks. */
function place(ctx: CanvasRenderingContext2D, kind: PieceKind, x: number, y: number): void {
  const { turn } = GLYPHS[kind] as Glyph;
  ctx.translate(x, y);
  ctx.scale(SIDE / GRID, SIDE / GRID);
  if (turn) {
    ctx.translate(GRID / 2, GRID / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.translate(-GRID / 2, -GRID / 2);
  }
  ctx.fillStyle = "#fff";
}

/** Fills the glyph's solid paths, then cuts its details out so the plate shows through. */
function glyph(ctx: CanvasRenderingContext2D, kind: PieceKind, x: number, y: number): void {
  const { solid, cut } = GLYPHS[kind] as Glyph;
  place(ctx, kind, x, y);
  ctx.fill(new Path2D(solid));
  if (cut) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill(new Path2D(cut));
  }
}

/**
 * The atlas, one RGBA texel per pixel of data rather than of colour: red is how
 * much light the plate catches (a gradient, a highlight and a dark rim), green
 * the white glyph, blue the warm accent and alpha the plate itself.
 */
function drawAtlas(): THREE.DataTexture {
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2D canvas for the pieces");
  const base = paint(ctx, (c, _kind, x, y) => {
    const gradient = c.createLinearGradient(0, y, 0, y + SIDE);
    gradient.addColorStop(0, "rgb(235,235,235)");
    gradient.addColorStop(1, "rgb(115,115,115)");
    plate(c, x, y);
    c.fillStyle = gradient;
    c.fill();
    c.save();
    c.clip();
    const sheen = c.createLinearGradient(0, y, 0, y + SIDE * 0.5);
    sheen.addColorStop(0, "rgba(255,255,255,0.28)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = sheen;
    c.fillRect(x, y, SIDE, SIDE * 0.5);
    c.restore();
    plate(c, x, y);
    c.lineWidth = 7;
    c.strokeStyle = "rgb(12,12,12)";
    c.stroke();
  });
  const white = paint(ctx, glyph);
  const accent = paint(ctx, (c, kind, x, y) => {
    const { accent: path } = GLYPHS[kind] as Glyph;
    if (!path) return;
    place(c, kind, x, y);
    c.fill(new Path2D(path));
  });
  const data = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i += 4) {
    data[i] = base[i] ?? 0;
    data[i + 1] = white[i + 3] ?? 0;
    data[i + 2] = accent[i + 3] ?? 0;
    data[i + 3] = base[i + 3] ?? 0;
  }
  const texture = new THREE.DataTexture(data, canvas.width, canvas.height);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

let atlas: THREE.DataTexture | undefined;

const vertexShader = /* glsl */ `
  uniform float worldWidth;
  uniform float cameraX;
  uniform bool wrapsX;
  uniform float unitScale;
  attribute float fade;
  out vec3 vColor;
  out vec2 vUv;
  out float vFade;

  void main() {
    vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 world = modelMatrix * instanceMatrix * vec4(position * unitScale, 1.0);
    // The copy of the world closest to the camera, judged by the centre of the piece.
    if (wrapsX) world.x += worldWidth * floor((cameraX - center.x) / worldWidth + 0.5);
    vColor = instanceColor;
    vUv = uv;
    vFade = fade;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec2 cell;
  in vec3 vColor;
  in vec2 vUv;
  in float vFade;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    vec4 t = texture(atlas, (cell + vec2(vUv.x, 1.0 - vUv.y)) / vec2(${String(COLS)}.0, ${String(ROWS)}.0));
    // White ink always; a light colour gets a darker plate so the ink and the edge stand out from land of the same colour.
    float light = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 rgb = mix(vColor * t.r * mix(1.0, 0.35, smoothstep(0.15, 0.45, light)), vec3(1.0), t.g);
    rgb = mix(rgb, vec3(1.0, 0.58, 0.05), t.b);
    // Faded and greyer while it is being built.
    rgb = mix(vec3(dot(rgb, vec3(0.3, 0.59, 0.11))), rgb, 0.35 + 0.65 * vFade);
    outColor = linearToOutputTexel(vec4(rgb, t.a * (0.5 + 0.5 * vFade)));
  }
`;

export interface PieceLayerOptions {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly wrapsX?: boolean;
  /** Most pieces drawn at once; the buffers are sized for it up front. */
  readonly capacity: number;
  /** Side of the plate in tiles. */
  readonly size: number;
  /** Which glyph the plate carries. */
  readonly kind: PieceKind;
  /** Drawn after layers with a lower order, over them. */
  readonly order: number;
}

/**
 * Every piece of one kind in a single instanced draw call, the same contract
 * as UnitLayer: positions in tiles, each piece moved next to the camera across
 * the east-west seam by the vertex shader.
 */
export class PieceLayer {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly cameraX = { value: 0 };
  private readonly unitScale = { value: 1 };
  private readonly fades: THREE.InstancedBufferAttribute;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor(readonly options: PieceLayerOptions) {
    atlas ??= drawAtlas();
    const index = PIECE_KINDS.indexOf(options.kind);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        worldWidth: { value: options.worldWidth },
        cameraX: this.cameraX,
        unitScale: this.unitScale,
        wrapsX: { value: options.wrapsX ?? true },
        atlas: { value: atlas },
        cell: { value: new THREE.Vector2(index % COLS, Math.floor(index / COLS)) },
      },
    });
    const geometry = new THREE.PlaneGeometry(options.size, options.size);
    this.fades = new THREE.InstancedBufferAttribute(new Float32Array(options.capacity), 1);
    this.fades.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("fade", this.fades);
    this.mesh = new THREE.InstancedMesh(geometry, material, options.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.set(0xffffff));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = options.order;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.count;
  }

  set count(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > this.options.capacity) {
      throw new RangeError(`piece count ${String(value)} exceeds the capacity`);
    }
    this.mesh.count = value;
  }

  /** Places piece `index` at tile coordinates (x, y), y counted from the north; unbuilt ones are drawn faded. */
  set(index: number, x: number, y: number, color: THREE.ColorRepresentation, built = true): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.options.capacity) {
      throw new RangeError(`piece ${String(index)} is outside the capacity`);
    }
    this.matrix.makeTranslation(x + 0.5, this.options.worldHeight - y - 0.5, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color.set(color));
    this.fades.setX(index, built ? 1 : 0);
    this.dirtyFrom = Math.min(this.dirtyFrom, index);
    this.dirtyTo = Math.max(this.dirtyTo, index);
  }

  /** Draws every piece this many times its footprint, around its centre. */
  setScale(scale: number): void {
    this.unitScale.value = scale;
  }

  /** Follows the camera across the seam and uploads what changed since the last call. */
  update(cameraX: number): void {
    this.cameraX.value = cameraX;
    if (this.dirtyTo < 0) return;
    const count = this.dirtyTo - this.dirtyFrom + 1;
    const { instanceMatrix, instanceColor } = this.mesh;
    instanceMatrix.addUpdateRange(this.dirtyFrom * 16, count * 16);
    instanceMatrix.needsUpdate = true;
    if (instanceColor) {
      instanceColor.addUpdateRange(this.dirtyFrom * 3, count * 3);
      instanceColor.needsUpdate = true;
    }
    this.fades.addUpdateRange(this.dirtyFrom, count);
    this.fades.needsUpdate = true;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
