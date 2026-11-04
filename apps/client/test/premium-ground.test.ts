import { afterEach, describe, expect, it, vi } from "vitest";

const base = new URL("https://example.test/frontfall/");

async function fresh(): Promise<typeof import("../src/render/premium-ground.ts")> {
  vi.resetModules();
  return import("../src/render/premium-ground.ts");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("premium ground", () => {
  it("is left out where the build holds none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 404 }))),
    );
    const { loadPremiumGround } = await fresh();
    await expect(loadPremiumGround("europe", "abc", base)).resolves.toBeUndefined();
  });

  it("is left out when baked from another version of the map", async () => {
    const index = { maps: { europe: { terrainSha256: "old", land: "l.webp", sea: "s.webp" } } };
    const fetch = vi.fn(() => Promise.resolve(Response.json(index)));
    vi.stubGlobal("fetch", fetch);
    const { loadPremiumGround } = await fresh();
    await expect(loadPremiumGround("europe", "new", base)).resolves.toBeUndefined();
    // Only the index was asked for, from the build's maps folder.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      "https://example.test/frontfall/maps/premium/index.json",
    );
  });

  it("decodes both images with their alpha kept apart", async () => {
    const index = { maps: { europe: { terrainSha256: "sum", land: "l.webp", sea: "s.webp" } } };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: URL) =>
        Promise.resolve(String(url).endsWith(".json") ? Response.json(index) : new Response("x")),
      ),
    );
    const decode = vi.fn((_blob: Blob, options: ImageBitmapOptions) =>
      Promise.resolve({ options } as unknown as ImageBitmap),
    );
    vi.stubGlobal("createImageBitmap", decode);
    const { loadPremiumGround } = await fresh();
    const ground = await loadPremiumGround("europe", "sum", base);
    expect(ground).toBeDefined();
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[0]?.[1]).toEqual({
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  });
});
