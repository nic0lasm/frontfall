import {
  BUILDING_KINDS,
  partsAt,
  type BuildingKind,
  type Level,
  type Op,
  type Role,
} from "./pieces-geo.ts";

/**
 * The painted miniatures of the eight buildings (docs/art-direction.md, pieces):
 * each is drawn once, at three levels of detail, into an atlas of 2D canvas
 * pixels when the game starts. A figurine stands on a painted base, lit from
 * the north-west, with a soft shadow falling to the south-east. The owner's
 * colour is left out of the pixels and added by the shader, so one atlas serves
 * every player: the roofs, banners and base are painted in grey and carry a
 * separate mask.
 */

/** Pixels of one cell of the atlas: one building at one level of detail. */
export const CELL = 128;
/** One column for each level of detail. */
export const COLUMNS = 3;
export const ROWS = BUILDING_KINDS.length;
/** The part of the 100-unit piece a cell shows: a margin all round for the shadow and the stroke. */
export const SPAN = { left: -60, top: -110, width: 120, height: 120 } as const;

type Rgb = readonly [number, number, number];

/** Stone, metal, wood and the small accents, by material and face (lit top, front, shaded side). */
const MATERIAL: Record<string, Rgb> = {
  wallF: [226, 215, 189],
  wallS: [180, 167, 137],
  wallT: [246, 239, 220],
  metalF: [174, 184, 196],
  metalS: [112, 124, 138],
  metalT: [217, 223, 230],
  goldF: [240, 181, 58],
  goldS: [185, 128, 26],
  goldT: [255, 220, 126],
  woodF: [169, 132, 86],
  woodS: [123, 92, 56],
  woodT: [201, 163, 115],
  dark: [38, 44, 54],
  glass: [143, 208, 230],
  flame: [255, 138, 31],
  white: [244, 244, 239],
};

/** How light the grey of each face of the owner's colour is painted; the shader multiplies it by the colour. */
const OWN_GREY: Record<string, number> = { ownF: 0.82, ownS: 0.5, ownT: 1, ownDF: 0.42 };

/** A hairline would vanish at world zoom: the stroke is heavier where the detail is coarser. */
const STROKE: readonly [number, number, number] = [3, 1.9, 1.35];

const rgb = ([r, g, b]: Rgb, factor = 1): string => {
  const mix = (v: number): number =>
    Math.round(Math.max(0, Math.min(255, factor <= 1 ? v * factor : v + (255 - v) * (factor - 1))));
  return `rgb(${String(mix(r))},${String(mix(g))},${String(mix(b))})`;
};

const grey = (g: number): Rgb => {
  const v = Math.round(Math.max(0, Math.min(1, g)) * 255);
  return [v, v, v];
};

const isOwner = (role: Role): boolean => role.startsWith("own");

/** The colour a part is painted in; an owner's part is grey, tinted later. */
function fillOf(role: Role): Rgb {
  return isOwner(role) ? grey(OWN_GREY[role] ?? 0.8) : (MATERIAL[role] ?? [255, 0, 255]);
}

function trace(ctx: CanvasRenderingContext2D, op: Op): void {
  ctx.beginPath();
  switch (op.kind) {
    case "polygon":
      op.points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      break;
    case "ellipse":
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, op.turn, 0, Math.PI * 2);
      break;
    case "cylinder":
      ctx.moveTo(op.cx - op.r, op.yb - op.h);
      ctx.lineTo(op.cx - op.r, op.yb);
      ctx.ellipse(op.cx, op.yb, op.r, op.r * 0.38, 0, Math.PI, 0, true);
      ctx.lineTo(op.cx + op.r, op.yb - op.h);
      ctx.closePath();
      break;
    case "dome":
      ctx.moveTo(op.cx - op.r, op.yb);
      ctx.bezierCurveTo(
        op.cx - op.r,
        op.yb - op.h * 1.25,
        op.cx + op.r,
        op.yb - op.h * 1.25,
        op.cx + op.r,
        op.yb,
      );
      ctx.closePath();
      break;
    case "cone":
      ctx.moveTo(op.cx - op.r, op.yb);
      ctx.lineTo(op.cx, op.yb - op.h);
      ctx.lineTo(op.cx + op.r, op.yb);
      ctx.ellipse(op.cx, op.yb, op.r, op.r * 0.38, 0, 0, Math.PI, false);
      ctx.closePath();
      break;
  }
}

/** A round part shades from the lit left side to the dark right one, like a painted turning. */
function turned(ctx: CanvasRenderingContext2D, op: Op, base: Rgb): string | CanvasGradient {
  if (op.kind !== "cylinder" && op.kind !== "dome" && op.kind !== "cone") return rgb(base);
  const gradient = ctx.createLinearGradient(op.cx - op.r, 0, op.cx + op.r, 0);
  gradient.addColorStop(0, rgb(base, 1.18));
  gradient.addColorStop(0.45, rgb(base));
  gradient.addColorStop(1, rgb(base, 0.62));
  return gradient;
}

const BASE = { rx: 47, ry: 15.5, y: -9 } as const;

function baseEllipse(ctx: CanvasRenderingContext2D, dy: number, shrink: number): void {
  ctx.beginPath();
  ctx.ellipse(0, BASE.y + dy, BASE.rx - shrink, BASE.ry - shrink, 0, 0, Math.PI * 2);
}

/** The shadow and the painted base. In the mask pass only the base, in white. */
function ground(ctx: CanvasRenderingContext2D, mask: boolean): void {
  if (mask) {
    ctx.fillStyle = "#fff";
    baseEllipse(ctx, 3, 0);
    ctx.fill();
    return;
  }
  // A soft contact shadow falling south-east.
  ctx.save();
  ctx.translate(8, -3);
  ctx.scale(1, 0.34);
  const shadow = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
  shadow.addColorStop(0, "rgba(10,12,16,0.55)");
  shadow.addColorStop(0.65, "rgba(10,12,16,0.28)");
  shadow.addColorStop(1, "rgba(10,12,16,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Dark rim, lighter top, and a thin pale lip on the lit side.
  ctx.fillStyle = rgb(grey(OWN_GREY.ownDF ?? 0.42));
  baseEllipse(ctx, 3, 0);
  ctx.fill();
  ctx.fillStyle = rgb(grey(0.78));
  baseEllipse(ctx, 0, 1);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, BASE.y, BASE.rx - 2.5, BASE.ry - 2.5, 0, Math.PI * 1.02, Math.PI * 1.95);
  ctx.stroke();
}

/**
 * One building at one level, in the 100-unit space of pieces-geo with the
 * origin at the bottom centre. `mask` paints the owner's parts white and the
 * rest black instead of colours.
 */
function figurine(
  ctx: CanvasRenderingContext2D,
  kind: BuildingKind,
  level: Level,
  mask: boolean,
): void {
  ground(ctx, mask);
  const width = STROKE[level];
  for (const op of partsAt(kind, level)) {
    trace(ctx, op);
    if (mask) {
      ctx.fillStyle = isOwner(op.role) ? "#fff" : "#000";
      ctx.fill();
      continue;
    }
    const base = fillOf(op.role);
    ctx.fillStyle = op.role.startsWith("gold") ? rgb(base) : turned(ctx, op, base);
    ctx.fill();
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.strokeStyle =
      op.role === "glass" || op.role === "dark" ? "rgba(0,0,0,0.3)" : "rgba(32,26,20,0.6)";
    ctx.stroke();
    // A pale rim on the lit faces keeps a light roof from melting into a light land.
    if (op.role.endsWith("T") && op.kind === "polygon") {
      ctx.save();
      ctx.clip();
      ctx.lineWidth = width * 2.4;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.stroke();
      ctx.restore();
    }
  }
}

function paintAll(canvas: HTMLCanvasElement, mask: boolean): Uint8ClampedArray {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2D canvas for the pieces");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = CELL / SPAN.width;
  BUILDING_KINDS.forEach((kind, row) => {
    for (let level = 0; level < COLUMNS; level++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(level * CELL, row * CELL, CELL, CELL);
      ctx.clip();
      ctx.translate(level * CELL - SPAN.left * k, row * CELL - SPAN.top * k);
      ctx.scale(k, k);
      figurine(ctx, kind, level as Level, mask);
      ctx.restore();
    }
  });
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * The atlas as two planes of premultiplied pixels: `colour` holds what is not
 * the owner's (red, green, blue, and the coverage in alpha), `owner` the grey
 * shading of the parts that are, which the shader multiplies by the colour.
 */
export function paintAtlas(): {
  colour: Uint8Array;
  owner: Uint8Array;
  width: number;
  height: number;
} {
  const canvas = document.createElement("canvas");
  canvas.width = COLUMNS * CELL;
  canvas.height = ROWS * CELL;
  const full = paintAll(canvas, false);
  const mask = paintAll(canvas, true);
  const colour = new Uint8Array(full.length);
  const owner = new Uint8Array(full.length / 4);
  for (let i = 0; i < owner.length; i++) {
    const at = i * 4;
    const alpha = (full[at + 3] ?? 0) / 255;
    // The mask is white on the owner's parts and black elsewhere: its red is their share of the pixel.
    const share = (mask[at] ?? 0) / 255;
    for (let c = 0; c < 3; c++) {
      colour[at + c] = Math.round((full[at + c] ?? 0) * (1 - share) * alpha);
    }
    colour[at + 3] = full[at + 3] ?? 0;
    owner[i] = Math.round((full[at] ?? 0) * share * alpha);
  }
  return { colour, owner, width: canvas.width, height: canvas.height };
}
