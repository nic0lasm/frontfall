import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("Bun version", () => {
  const pinned = /^bun@(\d+\.\d+\.\d+)$/.exec(
    (JSON.parse(read("package.json")) as { packageManager: string }).packageManager,
  )?.[1];

  it("is written once in package.json as packageManager", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the version CI installs", () => {
    expect(read(".github/actions/setup/action.yml")).toContain(`bun-version: ${String(pinned)}\n`);
  });

  it("is the version of the image the build and the server run on", () => {
    const images = [...read("Dockerfile").matchAll(/^FROM oven\/bun:([\d.]+)-alpine@sha256:/gm)];
    expect(images.map((image) => image[1])).toEqual([pinned]);
  });

  it("is the lowest version package.json allows", () => {
    expect((JSON.parse(read("package.json")) as { engines: { bun: string } }).engines.bun).toBe(
      `>=${String(pinned)}`,
    );
  });
});
