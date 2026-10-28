import { defineConfig } from "vite";

// The statistics page (stats.html), built after the game into the same dist/. A build of
// its own: as a second entry of vite.config.ts, the preload polyfill would leave the
// game's index chunk for one both pages share, outside the first-visit budget's files.
export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    emptyOutDir: false,
    // No dynamic import on this page, so nothing to preload.
    modulePreload: { polyfill: false },
    rollupOptions: { input: "stats.html" },
  },
});
