import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { minifyShader } from "../../tools/shader-minify.mjs";
import { simulationBuild } from "../../tools/simulation-build.mjs";
import { GENERATED_MAPS, generatedThumbnail } from "./src/maps.ts";

// The release is the version of the repository's root package.json, for the client and the server alike.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

/**
 * Shaders ship as text, so their comments, indentation and spaces would be
 * downloaded by every player: this minifies the template strings marked glsl.
 */
function minifyShaders(): Plugin {
  return {
    name: "frontfall:minify-shaders",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".ts") || !code.includes("/* glsl */")) return undefined;
      return code.replace(
        /\/\* glsl \*\/ `([^`]*)`/g,
        (_shader, body: string) => `/* glsl */ \`${minifyShader(body)}\``,
      );
    },
  };
}

/**
 * The menu waits for three things the page only discovers by running: a language
 * catalogue (a dynamic import), the map list and the font. Telling the browser about
 * them in index.html starts their download with the page's own scripts, a round trip
 * to the server earlier: the map list is never cached by the CDN, so each round trip
 * it waits for is one to the server itself.
 */
function preloadMenuInputs(): Plugin {
  return {
    name: "frontfall:preload-menu-inputs",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const files = Object.keys(context.bundle ?? {});
        const hashed = (pattern: RegExp): string[] => files.filter((file) => pattern.test(file));
        return [
          // Both catalogues: the page cannot tell which one it will show before it runs.
          ...hashed(/^assets\/(?:en|fr)-[^/]+\.js$/).map((file) => ({
            tag: "link",
            attrs: { rel: "modulepreload", crossorigin: "", href: `./${file}` },
            injectTo: "head" as const,
          })),
          ...hashed(/^assets\/inter-latin-wght-normal-[^/]+\.woff2$/).map((file) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              crossorigin: "",
              href: `./${file}`,
            },
            injectTo: "head" as const,
          })),
          // Not for the menu: the simulation worker is the game's last piece to arrive, so
          // the browser fetches it at low priority once the page is loaded.
          ...hashed(/^assets\/sim\.worker-[^/]+\.js$/).map((file) => ({
            tag: "link",
            attrs: { rel: "prefetch", href: `./${file}` },
            injectTo: "head" as const,
          })),
          {
            tag: "link",
            attrs: { rel: "preload", as: "fetch", crossorigin: "", href: "./maps/index.json" },
            injectTo: "head" as const,
          },
        ];
      },
    },
  };
}

/**
 * The pictures of the generated maps in the menu. Growing their land costs a few hundred
 * milliseconds of the page's own thread; the same land every time, so the build does it once.
 */
function generatedThumbnails(): Record<string, { width: number; height: number; bits: string }> {
  return Object.fromEntries(
    GENERATED_MAPS.map((info) => {
      const { width, height, cells } = generatedThumbnail(info.id);
      const bytes = Buffer.alloc(Math.ceil(cells.length / 8));
      cells.forEach((cell, i) => {
        if (cell === 1) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (1 << (i & 7));
      });
      return [info.id, { width, height, bits: bytes.toString("base64") }];
    }),
  );
}

export default defineConfig({
  plugins: [minifyShaders(), preloadMenuInputs()],
  // Relative URLs: the same build works at / and behind a path prefix such as /frontfall/.
  base: "./",
  define: {
    // Simulation build of the sources, not the commit; see src/build.ts.
    __FRONTFALL_SIMULATION__: JSON.stringify(simulationBuild()),
    // Release of the game, from the root package.json; see src/release.ts.
    __FRONTFALL_THUMBNAILS__: JSON.stringify(generatedThumbnails()),
    __FRONTFALL_RELEASE__: JSON.stringify(version),
  },
  build: {
    // Three.js alone is about 500 kB minified; it is cached across releases.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // zod and the module that sets it to parse without compiling share a chunk of their own,
        // which runs before the one holding the protocol's schemas: with the setting in the entry's
        // chunk it came after them, and the browser reported the try to compile on every visit.
        advancedChunks: {
          groups: [{ name: "zod", test: /node_modules\/zod\/|protocol\/src\/jitless\.ts/ }],
        },
      },
    },
  },
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
