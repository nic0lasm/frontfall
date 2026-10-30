import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { loadStaticFile } from "../src/static-files.ts";

describe("loadStaticFile", () => {
  let root: string;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "frontfall-static-"));
    root = join(base, "public");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<!doctype html>");
    await writeFile(join(root, "assets", "app.js"), "export {}");
    await writeFile(join(root, "assets", "data.bin"), "x");
    await writeFile(join(root, "manifest.webmanifest"), "{}");
    await writeFile(join(base, "secret.txt"), "do not serve");
    await writeFile(join(root, "world.bin"), new Uint8Array(64 * 1024).fill(1));
    await writeFile(join(root, "noise.json"), randomBytes(4096).toString("base64"));
    await writeFile(join(root, "flag.png"), new Uint8Array(4096));
    await writeFile(join(root, "preview.jpg"), new Uint8Array(4096));
  });

  it("serves index.html at the root", async () => {
    const file = await loadStaticFile(root, "/");
    expect(file?.contentType).toBe("text/html; charset=utf-8");
    expect(file?.body.toString()).toBe("<!doctype html>");
  });

  it("serves assets with their content type", async () => {
    expect((await loadStaticFile(root, "/assets/app.js"))?.contentType).toBe(
      "text/javascript; charset=utf-8",
    );
    expect((await loadStaticFile(root, "/assets/data.bin"))?.contentType).toBe(
      "application/octet-stream",
    );
    expect((await loadStaticFile(root, "/manifest.webmanifest"))?.contentType).toBe(
      "application/manifest+json",
    );
    expect((await loadStaticFile(root, "/preview.jpg"))?.contentType).toBe("image/jpeg");
  });

  it("refuses to leave the root", async () => {
    expect(await loadStaticFile(root, "/../secret.txt")).toBeUndefined();
    expect(await loadStaticFile(root, "/%2e%2e/secret.txt")).toBeUndefined();
    expect(await loadStaticFile(root + "/", "/../secret.txt")).toBeUndefined();
  });

  it("returns nothing for directories, missing files and bad encodings", async () => {
    expect(await loadStaticFile(root, "/assets")).toBeUndefined();
    expect(await loadStaticFile(root, "/missing.js")).toBeUndefined();
    expect(await loadStaticFile(root, "/%E0%A4%A")).toBeUndefined();
    expect(await loadStaticFile(root, "/index.html%00.js")).toBeUndefined();
  });

  it("keeps a gzip version of large text and map files", async () => {
    const map = await loadStaticFile(root, "/world.bin");
    expect(map?.contentType).toBe("application/octet-stream");
    expect(map?.gzip?.length).toBeLessThan(1024);
    expect(map?.gzip && gunzipSync(map.gzip).equals(map.body)).toBe(true);
    // Compressed once: the second load returns the same buffer.
    expect((await loadStaticFile(root, "/world.bin"))?.gzip).toBe(map?.gzip);
  });

  it("skips gzip for small files, images and data that does not shrink", async () => {
    expect((await loadStaticFile(root, "/index.html"))?.gzip).toBeUndefined();
    expect((await loadStaticFile(root, "/flag.png"))?.gzip).toBeUndefined();
    const noise = await loadStaticFile(root, "/noise.json");
    expect(noise?.gzip === undefined || noise.gzip.length < noise.body.length).toBe(true);
  });
});
