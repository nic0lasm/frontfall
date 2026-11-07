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
        "apps/client/src/build.ts",
        "apps/client/src/maps.ts",
        "apps/client/src/storage.ts",
        "apps/client/src/webgl-support.ts",
        "tools/src/clean-room.ts",
        "apps/client/src/render/**",
        "apps/client/src/input/**",
        "apps/client/src/game/**",
        "apps/client/src/i18n/**",
        "apps/client/src/release.ts",
        "apps/client/src/terrain.ts",
        "apps/client/src/signals.ts",
        "apps/client/src/ui/format.ts",
        "apps/client/src/ui/setup.ts",
        // The app shell's state machine, its addresses and what it hands the screens (ADR 0013).
        "apps/client/src/app/state.ts",
        "apps/client/src/app/address.ts",
        "apps/client/src/app/online-options.ts",
        "apps/client/src/app/screen-host.ts",
      ],
      // Barrel files, entry points, and the WebGL and worker glue, which only a browser
      // can run (covered end to end, like the DOM panels of apps/client/src/ui).
      exclude: [
        "packages/**/index.ts",
        "apps/server/src/main.ts",
        // Bun.serve, which Vitest on Node cannot start: `bun run test:bun` covers it.
        "apps/server/src/bun-transport.ts",
        // bun:sqlite and the admin command's entry point, run by Bun: `bun run test:bun` covers them.
        "apps/server/src/sql/bun-sqlite.ts",
        "apps/server/src/admin-main.ts",
        "apps/client/src/render/map-view.ts",
        "apps/client/src/render/gl-context.ts",
        "apps/client/src/render/minimap.ts",
        "apps/client/src/render/pieces.ts",
        "apps/client/src/render/pieces-paint.ts",
        "apps/client/src/game/sim-port.ts",
        "apps/client/src/game/sim.worker.ts",
      ],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
