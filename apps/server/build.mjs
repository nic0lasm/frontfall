import { build } from "esbuild";

// One self-contained file for the container image: no node_modules at runtime.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // ws is CommonJS and requires Node built-ins; give the ESM bundle a require.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Optional native accelerators of ws, absent on purpose.
  external: ["bufferutil", "utf-8-validate"],
});
