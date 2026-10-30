import * as THREE from "three";
import { BUILDING_KINDS, settleLevel, type BuildingKind, type Level } from "./pieces-geo.ts";
import { COLUMNS, ROWS as BUILDING_ROWS, SPAN, paintAtlas } from "./pieces-paint.ts";

/**
 * The game pieces of the flat map (docs/art-direction.md, pieces and
 * pictograms), drawn once into a small atlas when the game starts and sampled
 * by one instanced quad per kind. Buildings are painted miniatures on a base in
 * the owner's colour (pieces-paint.ts); ships and missiles are still token
 * plates with a white glyph. Kept out of the first visit: the page loads it
 * while the menu is open.
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
 * One silhouette each for the units, meant to read at 13 px: details are cut
 * out of the shape and at least two units wide, never hairlines.
 */
const GLYPHS = {
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

type UnitKind = keyof typeof GLYPHS;
export type PieceKind = BuildingKind | UnitKind;

const UNIT_KINDS = Object.keys(GLYPHS) as readonly UnitKind[];
/** Every kind the map draws, buildings first. */
export const PIECE_KINDS: readonly PieceKind[] = [...BUILDING_KINDS, ...UNIT_KINDS];

const isBuilding = (kind: PieceKind): kind is BuildingKind =>
  (BUILDING_KINDS as readonly string[]).includes(kind);

const COLS = 4;
const ROWS = Math.ceil(UNIT_KINDS.length / COLS);
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

type Pass = (ctx: CanvasRenderingContext2D, kind: UnitKind, x: number, y: number) => void;

/** Draws every cell with `pass` on a clear canvas and returns the pixels. */
function paint(ctx: CanvasRenderingContext2D, pass: Pass): Uint8ClampedArray {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  UNIT_KINDS.forEach((kind, i) => {
    ctx.save();
    pass(ctx, kind, (i % COLS) * CELL + PAD, Math.floor(i / COLS) * CELL + PAD);
    ctx.restore();
  });
  return ctx.getImageData(0, 0, width, height).data;
}

/** Puts the 24-unit grid on the plate at (x, y), turned as the glyph asks. */
function place(ctx: CanvasRenderingContext2D, kind: UnitKind, x: number, y: number): void {
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
function glyph(ctx: CanvasRenderingContext2D, kind: UnitKind, x: number, y: number): void {
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
function drawUnitAtlas(): THREE.DataTexture {
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

let unitAtlas: THREE.DataTexture | undefined;

interface FigurineAtlas {
  readonly colour: THREE.DataTexture;
  readonly owner: THREE.DataTexture;
}

let figurineAtlas: FigurineAtlas | undefined;

function drawFigurineAtlas(): FigurineAtlas {
  const { colour, owner, width, height } = paintAtlas();
  const mips = (texture: THREE.DataTexture): THREE.DataTexture => {
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  const one = new THREE.DataTexture(owner, width, height, THREE.RedFormat);
  one.unpackAlignment = 1;
  return { colour: mips(new THREE.DataTexture(colour, width, height)), owner: mips(one) };
}

const vertexShader = /* glsl */ `
  uniform float worldWidth;
  uniform float cameraX;
  uniform bool wrapsX;
  uniform float unitScale;
  uniform float pieceSize;
  uniform float shiftScale;
  attribute float fade;
  attribute vec2 shift;
  out vec3 vColor;
  out vec2 vUv;
  out float vFade;

  void main() {
    vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // The shift attribute moves a piece by fractions of its own size: the satellites of a group, and its count.
    vec4 world = modelMatrix * instanceMatrix * vec4(position * unitScale + vec3(shift * pieceSize * shiftScale, 0.0), 1.0);
    // The copy of the world closest to the camera, judged by the centre of the piece.
    if (wrapsX) world.x += worldWidth * floor((cameraX - center.x) / worldWidth + 0.5);
    vColor = instanceColor;
    vUv = uv;
    vFade = fade;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const unitFragmentShader = /* glsl */ `
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

/**
 * The painted atlas holds display-space colours (what the painter saw), so the
 * piece is put together in that space and converted once at the end: stone and
 * metal as painted, the owner's parts as a grey times the owner's colour, and a
 * darker tint for a light colour so a roof stands out from land of the same hue.
 */
const figurineFragmentShader = /* glsl */ `
  uniform sampler2D atlas;
  uniform sampler2D ownerAtlas;
  uniform vec2 cell;
  in vec3 vColor;
  in vec2 vUv;
  in float vFade;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    vec2 at = (cell + vec2(vUv.x, 1.0 - vUv.y)) / vec2(${String(COLUMNS)}.0, ${String(BUILDING_ROWS)}.0);
    vec4 t = texture(atlas, at);
    if (t.a < 0.004) discard;
    float own = texture(ownerAtlas, at).r;
    float light = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = pow(vColor, vec3(1.0 / 2.2)) * mix(1.0, 0.7, smoothstep(0.45, 0.7, light));
    vec3 paint = (t.rgb + own * tint) / t.a;
    // Greyer and fainter while it is being built.
    paint = mix(vec3(dot(paint, vec3(0.3, 0.59, 0.11))), paint, 0.35 + 0.65 * vFade);
    outColor = linearToOutputTexel(vec4(pow(paint, vec3(2.2)), t.a * (0.55 + 0.45 * vFade)));
  }
`;

export interface PieceLayerOptions {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly wrapsX?: boolean;
  /** Most pieces drawn at once; the buffers are sized for it up front. */
  readonly capacity: number;
  /** Side of the piece in tiles. */
  readonly size: number;
  /** What the piece is: a painted building, or a token plate with a glyph. */
  readonly kind: PieceKind;
  /** Drawn after layers with a lower order, over them. */
  readonly order: number;
}

/** Local height of the base's centre in the 100-unit piece (pieces-paint.ts): the tile is under it. */
const GROUND_Y = -9;

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
  private readonly shiftScale = { value: 1 };
  private readonly fades: THREE.InstancedBufferAttribute;
  private readonly shifts: THREE.InstancedBufferAttribute;
  private readonly column: { value: THREE.Vector2 } | undefined;
  private readonly row: number;
  private level: Level = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor(readonly options: PieceLayerOptions) {
    const { kind } = options;
    const building = isBuilding(kind);
    const shared = {
      worldWidth: { value: options.worldWidth },
      cameraX: this.cameraX,
      unitScale: this.unitScale,
      wrapsX: { value: options.wrapsX ?? true },
      pieceSize: { value: options.size },
      shiftScale: this.shiftScale,
    };
    let material: THREE.ShaderMaterial;
    let geometry: THREE.PlaneGeometry;
    if (building) {
      figurineAtlas ??= drawFigurineAtlas();
      this.row = BUILDING_KINDS.indexOf(kind);
      this.column = { value: new THREE.Vector2(0, this.row) };
      material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader: figurineFragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...shared,
          atlas: { value: figurineAtlas.colour },
          ownerAtlas: { value: figurineAtlas.owner },
          cell: this.column,
        },
      });
      // The quad shows 120 units of the 100-unit piece; the base sits on the tile, the figure rises north of it.
      const side = (options.size * SPAN.width) / 100;
      geometry = new THREE.PlaneGeometry(side, side);
      geometry.translate(0, ((GROUND_Y - (SPAN.top + SPAN.height / 2)) / 100) * options.size, 0);
    } else {
      unitAtlas ??= drawUnitAtlas();
      this.row = UNIT_KINDS.indexOf(kind);
      material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader: unitFragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...shared,
          atlas: { value: unitAtlas },
          cell: { value: new THREE.Vector2(this.row % COLS, Math.floor(this.row / COLS)) },
        },
      });
      geometry = new THREE.PlaneGeometry(options.size, options.size);
    }
    this.fades = new THREE.InstancedBufferAttribute(new Float32Array(options.capacity), 1);
    this.fades.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("fade", this.fades);
    this.shifts = new THREE.InstancedBufferAttribute(new Float32Array(options.capacity * 2), 2);
    this.shifts.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("shift", this.shifts);
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

  /**
   * Places piece `index` at tile coordinates (x, y), y counted from the north; unbuilt ones are drawn faded.
   * `shiftX` and `shiftY` move it by fractions of its size, y up: the satellites of a group.
   */
  set(
    index: number,
    x: number,
    y: number,
    color: THREE.ColorRepresentation,
    built = true,
    shiftX = 0,
    shiftY = 0,
  ): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.options.capacity) {
      throw new RangeError(`piece ${String(index)} is outside the capacity`);
    }
    this.matrix.makeTranslation(x + 0.5, this.options.worldHeight - y - 0.5, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color.set(color));
    this.fades.setX(index, built ? 1 : 0);
    this.shifts.setXY(index, shiftX, shiftY);
    this.dirtyFrom = Math.min(this.dirtyFrom, index);
    this.dirtyTo = Math.max(this.dirtyTo, index);
  }

  /** Draws every piece this many times its footprint, around its centre. */
  setScale(scale: number): void {
    this.unitScale.value = scale;
    this.shiftScale.value = scale;
  }

  /**
   * Tells a painted building how large it is on screen, in CSS pixels, to pick
   * its level of detail.
   */
  setPixels(pixels: number): void {
    if (!this.column) return;
    this.level = settleLevel(this.level, pixels);
    this.column.value.x = this.level;
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
    this.shifts.addUpdateRange(this.dirtyFrom * 2, count * 2);
    this.shifts.needsUpdate = true;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/** Pixels of one digit cell of the count atlas, and its grid. */
const COIN = 48;
const COIN_COLUMNS = 10;
/** Largest count with its own cell; more is written "99+". */
const COIN_MAX = 99;

let countAtlas: THREE.CanvasTexture | undefined;

/** Every count from 2 to 99, then "99+", each on a dark coin ringed in white so it reads without colour. */
function drawCountAtlas(): THREE.CanvasTexture {
  const cells = COIN_MAX - 1;
  const canvas = document.createElement("canvas");
  canvas.width = COIN * COIN_COLUMNS;
  canvas.height = COIN * Math.ceil(cells / COIN_COLUMNS);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas for the counts");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < cells; i++) {
    const x = (i % COIN_COLUMNS) * COIN + COIN / 2;
    const y = Math.floor(i / COIN_COLUMNS) * COIN + COIN / 2;
    ctx.beginPath();
    ctx.arc(x, y, COIN / 2 - 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#111b26";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    const text = i === cells - 1 ? `${String(COIN_MAX)}+` : String(i + 2);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${String(text.length > 2 ? 22 : 31)}px Inter, system-ui, sans-serif`;
    ctx.fillText(text, x, y + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Rows are counted from the top, as in the other atlases.
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

const countFragmentShader = /* glsl */ `
  uniform sampler2D atlas;
  in vec3 vColor;
  in vec2 vUv;
  in float vFade;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    // The cell number rides in the instance colour's red, in whole units.
    float n = floor(vColor.r * 255.0 + 0.5);
    vec2 cell = vec2(mod(n, ${String(COIN_COLUMNS)}.0), floor(n / ${String(COIN_COLUMNS)}.0));
    vec2 grid = vec2(${String(COIN_COLUMNS)}.0, ${String(Math.ceil((COIN_MAX - 1) / COIN_COLUMNS))}.0);
    vec4 t = texture(atlas, (cell + vec2(vUv.x, 1.0 - vUv.y)) / grid);
    outColor = linearToOutputTexel(t);
  }
`;

/**
 * The counts that go with the groups of pieces: one coin each, sized in pixels
 * and moved by the same fraction of the piece as its satellites, so it follows
 * the group as the view zooms.
 */
export class CountLayer {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly cameraX = { value: 0 };
  private readonly unitScale = { value: 1 };
  private readonly shiftScale = { value: 1 };
  private readonly shifts: THREE.InstancedBufferAttribute;
  private readonly cell = new THREE.Color();
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor(
    readonly options: {
      readonly worldWidth: number;
      readonly worldHeight: number;
      readonly wrapsX?: boolean;
      readonly capacity: number;
      /** Size in tiles of the piece the coin belongs to, which its shift is a fraction of. */
      readonly size: number;
      readonly order: number;
    },
  ) {
    countAtlas ??= drawCountAtlas();
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader: countFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        worldWidth: { value: options.worldWidth },
        cameraX: this.cameraX,
        unitScale: this.unitScale,
        shiftScale: this.shiftScale,
        wrapsX: { value: options.wrapsX ?? true },
        pieceSize: { value: options.size },
        atlas: { value: countAtlas },
      },
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute(
      "fade",
      new THREE.InstancedBufferAttribute(new Float32Array(options.capacity).fill(1), 1),
    );
    this.shifts = new THREE.InstancedBufferAttribute(new Float32Array(options.capacity * 2), 2);
    this.shifts.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("shift", this.shifts);
    this.mesh = new THREE.InstancedMesh(geometry, material, options.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.cell.setRGB(0, 0, 0));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = options.order;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.count;
  }

  set count(value: number) {
    this.mesh.count = value;
  }

  /** Puts a coin of `n` (2 or more) beside the piece at tile (x, y), shifted by fractions of its size, y up. */
  set(index: number, x: number, y: number, n: number, shiftX: number, shiftY: number): void {
    this.matrix.makeTranslation(x + 0.5, this.options.worldHeight - y - 0.5, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    // The cell number goes in the red channel of the instance colour as a raw value (no colour space).
    const cellIndex = Math.min(Math.max(n, 2), COIN_MAX + 1) - 2;
    this.mesh.setColorAt(
      index,
      this.cell.setRGB(cellIndex / 255, 0, 0, THREE.LinearSRGBColorSpace),
    );
    this.shifts.setXY(index, shiftX, shiftY);
    this.dirtyFrom = Math.min(this.dirtyFrom, index);
    this.dirtyTo = Math.max(this.dirtyTo, index);
  }

  /** `coin` tiles for the side of the coin, `piece` for the scale of the piece it is shifted along with. */
  setScale(coin: number, piece: number): void {
    this.unitScale.value = coin;
    this.shiftScale.value = piece;
  }

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
    this.shifts.addUpdateRange(this.dirtyFrom * 2, count * 2);
    this.shifts.needsUpdate = true;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
