import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulationBuild, simulationFiles } from "../simulation-build.mjs";

/** A copy of the repository's layout with only the given files. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "simulation-"));
  for (const dir of [
    "packages/engine/src",
    "packages/contracts/src",
    "packages/protocol/src",
    "apps/client/public/maps",
    "apps/client/src/game",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

const BASE = {
  "packages/engine/src/game.ts": "export const a = 1;\n",
  "packages/engine/src/bots/bots.ts": "export const b = 2;\n",
  "packages/contracts/src/orders.ts": "export const o = 5;\n",
  "packages/protocol/src/index.ts": "export const c = 3;\n",
  "apps/client/public/maps/world.json": "{}\n",
  "apps/client/src/game/simulation.ts": "export const d = 4;\n",
};

describe("simulation build", () => {
  it("covers the engine, the contracts, the protocol, the maps and the client's setup of a game", () => {
    const files = simulationFiles();
    expect(files).toContain("packages/engine/src/balance.ts");
    expect(files).toContain("packages/contracts/src/orders.ts");
    expect(files).toContain("packages/protocol/src/index.ts");
    expect(files).toContain("apps/client/public/maps/world.bin");
    expect(files).toContain("apps/client/src/game/simulation.ts");
    expect(files).not.toContain("apps/client/src/game/game-runner.ts");
    expect(files.some((file) => file.endsWith(".png") || file.includes("/test/"))).toBe(false);
  });

  it("is twelve hex digits", () => {
    expect(simulationBuild()).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes with any covered file and nothing else", () => {
    const base = simulationBuild(tree(BASE));
    expect(simulationBuild(tree(BASE))).toBe(base);
    expect(
      simulationBuild(
        tree({ ...BASE, "packages/engine/src/bots/bots.ts": "export const b = 3;\n" }),
      ),
    ).not.toBe(base);
    expect(
      simulationBuild(tree({ ...BASE, "apps/client/public/maps/world.json": "{ }\n" })),
    ).not.toBe(base);
    expect(
      simulationBuild(
        tree({ ...BASE, "packages/contracts/src/orders.ts": "export const o = 6;\n" }),
      ),
    ).not.toBe(base);
    expect(
      simulationBuild(
        tree({
          ...BASE,
          "apps/client/src/game/game-runner.ts": "export const e = 5;\n",
          "apps/client/public/maps/world.png": "picture",
          "packages/engine/README.md": "notes",
        }),
      ),
    ).toBe(base);
  });

  it("ignores carriage returns in text files", () => {
    const base = simulationBuild(tree(BASE));
    expect(
      simulationBuild(tree({ ...BASE, "packages/engine/src/game.ts": "export const a = 1;\r\n" })),
    ).toBe(base);
  });
});
