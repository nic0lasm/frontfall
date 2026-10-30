/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMaps, fetchManifest, generatedThumbnail, GENERATED_MAPS } from "../src/game/maps.ts";
import { prebakeGround, takeBakedGround } from "../src/render/prebaked-ground.ts";

const PAGE = "https://example.test/frontfall/";
const PUBLIC = new URL("../public/", import.meta.url);

const fromDisk = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(PAGE)) return new Response(null, { status: 404 });
  try {
    return new Response(await readFile(new URL(url.slice(PAGE.length), PUBLIC)));
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

/** A worker that answers at once, as the terrain worker does when it is done. */
class FakeWorker {
  static posted = 0;
  onmessage: ((event: MessageEvent) => void) | undefined;
  onerror: (() => void) | undefined;
  postMessage(message: { info: { id: string }; manifest: { terrain: { sha256: string } } }): void {
    FakeWorker.posted++;
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          id: message.info.id,
          sha256: message.manifest.terrain.sha256,
          colors: new Uint8Array(4),
          heights: new Uint8Array(1),
        },
      } as MessageEvent);
    });
  }
  terminate(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.posted = 0;
});

describe("the ground baked ahead", () => {
  it("hands over the ground once, only for the terrain it was baked from", async () => {
    vi.stubGlobal("fetch", fromDisk);
    vi.stubGlobal("Worker", FakeWorker);
    const world = (await fetchMaps(PAGE, fromDisk)).find((map) => map.id === "world");
    if (!world) throw new Error("no World");
    const manifest = await fetchManifest(world, fromDisk);
    const sha256 = manifest?.terrain.sha256;

    expect(takeBakedGround("world", sha256)).toBeUndefined();
    await prebakeGround(world);
    await prebakeGround(world);
    expect(FakeWorker.posted).toBe(1);
    expect(takeBakedGround("world", "another terrain")).toBeUndefined();
    // Taken even when it did not fit: the next game bakes its own, and the menu asks again.
    expect(takeBakedGround("world", sha256)).toBeUndefined();

    await prebakeGround(world);
    expect(takeBakedGround("world", sha256)?.heights).toHaveLength(1);
    expect(takeBakedGround("world", sha256)).toBeUndefined();
  });

  it("leaves generated maps to the game screen", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    for (const info of GENERATED_MAPS) await prebakeGround(info);
    expect(FakeWorker.posted).toBe(0);
  });
});

describe("generated map pictures", () => {
  it("are sampled to at most 160 columns, with land and sea in them", () => {
    for (const info of GENERATED_MAPS) {
      const { width, height, cells } = generatedThumbnail(info.id);
      expect(width).toBeLessThanOrEqual(160);
      expect(cells).toHaveLength(width * height);
      const land = cells.reduce((sum, cell) => sum + cell, 0);
      expect(land).toBeGreaterThan(0);
      expect(land).toBeLessThan(cells.length);
    }
  });
});
