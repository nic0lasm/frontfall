import { describe, expect, it } from "vitest";
import { hexToRgb, PLAYER_COLORS } from "../src/palette.ts";
import { parseSettings } from "../src/ui/accessibility.ts";

describe("accessibility settings", () => {
  it("starts from the defaults and mends anything unreadable", () => {
    const defaults = {
      scale: 100,
      reduceMotion: false,
      highContrast: false,
      volume: 60,
      muted: false,
    };
    expect(parseSettings(null)).toEqual(defaults);
    expect(parseSettings("not json")).toEqual(defaults);
    expect(parseSettings("42")).toEqual(defaults);
    expect(parseSettings('{"scale":999,"reduceMotion":"yes"}')).toEqual(defaults);
  });

  it("keeps what was chosen", () => {
    expect(
      parseSettings(
        '{"scale":125,"reduceMotion":true,"highContrast":true,"volume":30,"muted":true}',
      ),
    ).toEqual({ scale: 125, reduceMotion: true, highContrast: true, volume: 30, muted: true });
  });

  it("keeps the volume within range", () => {
    expect(parseSettings('{"volume":250}').volume).toBe(100);
    expect(parseSettings('{"volume":-5}').volume).toBe(0);
    expect(parseSettings('{"volume":"loud"}').volume).toBe(60);
  });
});

/** Machado et al. (2009) matrices at full severity, on linear RGB. */
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
] as const;
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
] as const;

const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** CIE Lab of a colour as seen through a simulation matrix. */
function lab(
  rgb: readonly number[],
  matrix: readonly (readonly number[])[],
): [number, number, number] {
  const [lr = 0, lg = 0, lb = 0] = rgb.map((c) => linear(c / 255));
  const [r = 0, g = 0, b = 0] = matrix.map(
    (row) => (row[0] ?? 0) * lr + (row[1] ?? 0) * lg + (row[2] ?? 0) * lb,
  );
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

describe("player colours under colour blindness", () => {
  it.each([
    ["deuteranopia", DEUTAN],
    ["protanopia", PROTAN],
  ] as const)("keep the first eight apart in %s", (_name, matrix) => {
    const seen = PLAYER_COLORS.slice(0, 8).map(({ hex }) => lab(hexToRgb(hex), matrix));
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const [l1 = 0, a1 = 0, b1 = 0] = seen[i] ?? [];
        const [l2 = 0, a2 = 0, b2 = 0] = seen[j] ?? [];
        expect(Math.hypot(l1 - l2, a1 - a2, b1 - b2)).toBeGreaterThan(8);
      }
    }
  });
});
