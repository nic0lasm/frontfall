import { accessibility, motionReduced } from "./accessibility.ts";
import type { Cue } from "../audio/cues.ts";

/** Vibration patterns in milliseconds, kept short: a touch to feel, not a buzz to endure. */
const PATTERNS: Partial<Record<Cue, number | number[]>> = {
  attack: 40,
  conquest: 20,
  grand: 30,
  victory: [30, 60, 30, 60, 80],
  defeat: [120, 80, 120],
};

/** The pattern to vibrate for a cue, or none when the player or the system asks for calm. */
export function hapticFor(cue: Cue): number | number[] | undefined {
  if (!accessibility().haptics || motionReduced()) return undefined;
  return PATTERNS[cue];
}

/** Vibrates for a cue where the device can; silently nothing elsewhere. */
export function haptic(cue: Cue): void {
  const pattern = hapticFor(cue);
  if (pattern === undefined || typeof navigator.vibrate !== "function") return;
  // Chrome refuses to vibrate before the page was touched, and says so by returning false.
  navigator.vibrate(pattern);
}
