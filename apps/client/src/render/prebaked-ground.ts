import { fetchManifest, type MapInfo } from "../game/maps.ts";

/** The ground of a map as bakeTerrainColors makes it, with the heights the shader lights it from. */
export interface BakedGround {
  readonly colors: Uint8Array;
  readonly heights: Uint8Array;
}

/** What the terrain worker answers: the ground of the map whose terrain has this checksum. */
export interface GroundReply extends BakedGround {
  readonly id: string;
  readonly sha256: string;
}

type Entry =
  { state: "pending"; wanted: boolean } | { state: "ready"; sha256: string; ground: BakedGround };

const entries = new Map<string, Entry>();

/**
 * Bakes the ground of a published map in a worker, so that the game screen finds it ready
 * instead of spending a second of the page's own thread on it when the game starts. Once per
 * map until taken; a browser or a map that cannot do it leaves the bake to the game screen.
 */
export async function prebakeGround(info: MapInfo): Promise<void> {
  if (!info.manifest || entries.has(info.id) || typeof Worker !== "function") return;
  entries.set(info.id, { state: "pending", wanted: false });
  try {
    const manifest = await fetchManifest(info);
    if (!manifest) throw new Error("no manifest");
    const worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<GroundReply>) => {
      worker.terminate();
      const { id, sha256, colors, heights } = event.data;
      const entry = entries.get(id);
      // The game screen did not wait for it: nothing will ask for it, so it is not kept.
      if (entry?.state === "pending" && entry.wanted) entries.delete(id);
      else entries.set(id, { state: "ready", sha256, ground: { colors, heights } });
    };
    worker.onerror = () => {
      worker.terminate();
      entries.delete(info.id);
    };
    worker.postMessage({ info, manifest });
  } catch {
    entries.delete(info.id);
  }
}

/**
 * The ground baked ahead for this map, once: the caller owns it. Undefined when the bake has
 * not finished, was not asked for, or was made from other terrain than the one the game plays.
 */
export function takeBakedGround(id: string, sha256: string | undefined): BakedGround | undefined {
  const entry = entries.get(id);
  if (!entry) return undefined;
  if (entry.state === "pending") {
    entry.wanted = true;
    return undefined;
  }
  entries.delete(id);
  return entry.sha256 === sha256 ? entry.ground : undefined;
}
