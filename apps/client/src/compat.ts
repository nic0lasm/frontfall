import type { MessageKey } from "./i18n/index.ts";
import { hasWebGL2 } from "./webgl-support.ts";

/** What the browser must provide for a game to start, with the text that names it. */
export type Feature = "webgl2" | "worker";

export const FEATURE_LABELS: Readonly<Record<Feature, MessageKey>> = {
  webgl2: "compat.feature.webgl2",
  worker: "compat.feature.worker",
};

/** The parts of the page's environment this check looks at, so they can be faked in tests. */
export interface Environment {
  readonly Worker?: unknown;
  readonly hasWebGL2: () => boolean;
}

/**
 * The indispensable features this browser lacks, empty when it can run the game.
 * Storage, the clipboard and file compression are not listed: without them the
 * game still plays, and only a setting, an invitation or a download is lost.
 */
export function missingFeatures(
  env: Environment = { Worker: globalThis.Worker, hasWebGL2 },
): readonly Feature[] {
  const missing: Feature[] = [];
  if (!env.hasWebGL2()) missing.push("webgl2");
  if (typeof env.Worker !== "function") missing.push("worker");
  return missing;
}
