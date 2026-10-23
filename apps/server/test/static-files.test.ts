import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await writeFile(join(base, "secret.txt"), "do not serve");
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
});
