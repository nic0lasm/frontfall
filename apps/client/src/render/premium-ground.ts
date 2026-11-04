/**
 * The premium ground of a published map (docs/premium-graphics.md), when the
 * build holds one: maps/premium/index.json lists the baked maps with the
 * checksum of the terrain they were baked from. A build without them, such as
 * the web game, answers undefined and the map is drawn as before.
 */
import type { PremiumGround } from "./territory-layer.ts";

interface PremiumIndex {
  readonly maps?: Record<
    string,
    { readonly terrainSha256?: string; readonly land?: string; readonly sea?: string }
  >;
}

let index: Promise<PremiumIndex | undefined> | undefined;

function readIndex(base: URL): Promise<PremiumIndex | undefined> {
  index ??= fetch(new URL("maps/premium/index.json", base))
    .then((response) => (response.ok ? (response.json() as Promise<PremiumIndex>) : undefined))
    .catch(() => undefined);
  return index;
}

/** Decodes an image with its alpha kept apart from its colour: the land's alpha is its light. */
async function bitmap(url: URL): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return createImageBitmap(await response.blob(), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
}

/** The ground baked for a map and its terrain, or undefined where there is none or it fails to load. */
export async function loadPremiumGround(
  id: string,
  sha256: string,
  base: URL = new URL(".", location.href),
): Promise<PremiumGround | undefined> {
  const entry = (await readIndex(base))?.maps?.[id];
  // Baked from another version of the map: its coasts would not match.
  if (!entry?.land || !entry.sea || entry.terrainSha256 !== sha256) return undefined;
  try {
    const folder = new URL("maps/premium/", base);
    const [land, sea] = await Promise.all([
      bitmap(new URL(entry.land, folder)),
      bitmap(new URL(entry.sea, folder)),
    ]);
    return { land, sea };
  } catch (error) {
    console.warn(`premium ground of ${id}:`, error);
    return undefined;
  }
}
