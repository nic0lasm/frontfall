import { MAX_PIXEL_RATIO } from "../render/render-scale.ts";

/** How the player asks for the map to be drawn: by the device (auto), light, or as sharp as it goes. */
export const GRAPHICS_MODES = ["auto", "saver", "quality"] as const;
export type GraphicsMode = (typeof GRAPHICS_MODES)[number];

/** What the map is drawn with. */
export interface GraphicsProfile {
  /** The light picture: a flat map and a sharpest ratio of one. */
  readonly saver: boolean;
  /** Highest device pixels per CSS pixel the map is drawn at. */
  readonly maxPixelRatio: number;
  /** The map in square tiles, without smooth coasts and borders. */
  readonly flat: boolean;
}

export const QUALITY: GraphicsProfile = {
  saver: false,
  maxPixelRatio: MAX_PIXEL_RATIO,
  flat: false,
};
/** The full picture on a phone, at 1.5 times its screen's pixels instead of twice. */
export const BALANCED: GraphicsProfile = { saver: false, maxPixelRatio: 1.5, flat: false };
export const SAVER: GraphicsProfile = { saver: true, maxPixelRatio: 1, flat: true };

/** What the browser tells about the device, all of it optional but the screen. */
export interface DeviceSignals {
  /** The main pointer is a finger. */
  readonly touch: boolean;
  /** The shorter side of the screen and of the window in CSS pixels. */
  readonly shortSide: number;
  /** Gigabytes of memory rounded down to a power of two, where the browser tells (Chromium). */
  readonly memoryGb?: number | undefined;
  readonly cores?: number | undefined;
}

/** A phone: a finger and a screen narrower than any tablet. */
export function isPhone(device: DeviceSignals): boolean {
  return device.touch && device.shortSide < 600;
}

/** A device that cannot be asked for much: little memory, or few cores for a phone. */
export function isLowEnd(device: DeviceSignals): boolean {
  const { memoryGb, cores } = device;
  if (memoryGb !== undefined && memoryGb <= 2) return true;
  if (cores !== undefined && cores <= 2) return true;
  return (
    device.touch &&
    ((memoryGb !== undefined && memoryGb <= 4) || (cores !== undefined && cores <= 4))
  );
}

/**
 * The profile to draw a game with. A chosen mode is kept. In auto, a device
 * that proved too slow (`learned`) or is weak gets the light picture, a phone
 * a little less sharp one, and any other device the full one; the scale of the
 * map (render-scale.ts) still steps down below that while frames fall behind.
 */
export function chooseProfile(
  mode: GraphicsMode,
  device: DeviceSignals,
  learned: boolean,
): GraphicsProfile {
  if (mode === "saver") return SAVER;
  if (mode === "quality") return QUALITY;
  if (learned || isLowEnd(device)) return SAVER;
  return isPhone(device) ? BALANCED : QUALITY;
}

export function readDevice(): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    touch: matchMedia("(pointer: coarse)").matches,
    shortSide: Math.min(
      window.screen.width,
      window.screen.height,
      window.innerWidth,
      window.innerHeight,
    ),
    memoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : undefined,
  };
}

const LEARNED_KEY = "frontfall.graphics.saver";

/** Whether an earlier game on this device could not keep up even at the lowest sharpness. */
export function learnedSaver(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(LEARNED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSaver(storage: Pick<Storage, "setItem"> | undefined): void {
  try {
    storage?.setItem(LEARNED_KEY, "1");
  } catch {
    // The light picture then lasts until the page is closed.
  }
}
