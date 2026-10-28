import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "tools", "bench"],
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**",
        "apps/server/src/**",
        "apps/client/src/net/**",
        "apps/client/src/palette.ts",
        "tools/src/clean-room.ts",
        "apps/client/src/render/**",
        "apps/client/src/input/**",
        "apps/client/src/game/**",
        "apps/client/src/i18n/**",
        "apps/client/src/release.ts",
        "apps/client/src/terrain.ts",
        "apps/client/src/ui/format.ts",
        "apps/client/src/ui/setup.ts",
      ],
      // Barrel files, entry points, and the WebGL and worker glue, which only a browser
      // can run (covered end to end, like the DOM panels of apps/client/src/ui).
      exclude: [
        "packages/**/index.ts",
        "apps/server/src/main.ts",
        "apps/client/src/render/map-view.ts",
        "apps/client/src/render/minimap.ts",
        "apps/client/src/game/local-session.ts",
        "apps/client/src/game/sim.worker.ts",
      ],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
