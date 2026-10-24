import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import type { RenderResult } from "./page.ts";

const { values } = parseArgs({
  // `pnpm bench -- --quick` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    // Use the machine's GPU instead of the SwiftShader software rasteriser.
    gpu: { type: "boolean", default: false },
    quick: { type: "boolean", default: false },
    // The globe prototype instead of the flat map (ADR 0005).
    globe: { type: "boolean", default: false },
    // Only serve the page, to open it by hand in any browser or on a phone.
    serve: { type: "boolean", default: false },
    json: { type: "string" },
  },
});

const flatCases = [
  { width: 4096, height: 2048, players: 64, units: 10_000, viewport: [1280, 720] },
  { width: 2048, height: 1024, players: 32, units: 2_000, viewport: [1280, 720] },
  // A phone in portrait at a device pixel ratio capped to 2.
  { width: 2048, height: 1024, players: 32, units: 2_000, viewport: [780, 1688] },
] as const;
// The planet whole on screen, then close enough that every pixel is ground.
const globeCases = [
  { width: 2048, height: 1024, players: 32, units: 0, viewport: [1280, 720], zoom: 1.5 },
  { width: 2048, height: 1024, players: 32, units: 0, viewport: [1280, 720], zoom: 8 },
  { width: 2048, height: 1024, players: 32, units: 0, viewport: [780, 1688], zoom: 8 },
] as const;
const cases = values.globe ? globeCases : flatCases;
const frames = values.quick ? 20 : 120;

const root = fileURLToPath(new URL(".", import.meta.url));
const server = await createServer({
  root,
  logLevel: "error",
  server: {
    port: values.serve ? 5180 : 0,
    host: values.serve,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
await server.listen();
const address = server.resolvedUrls?.local[0];
if (!address) throw new Error("the benchmark page server did not start");

if (values.serve) {
  console.log(`Benchmark page: ${address}?width=4096&height=2048&units=10000`);
  console.log("Results appear on the page. Press Ctrl+C to stop.");
  await new Promise(() => undefined);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  args: values.gpu
    ? ["--ignore-gpu-blocklist", "--enable-gpu"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const ms = (value: number): string => value.toFixed(1);
const results: RenderResult[] = [];
try {
  for (const c of cases) {
    const [viewportWidth, viewportHeight] = c.viewport;
    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: viewportHeight },
    });
    const query = new URLSearchParams({
      width: String(c.width),
      height: String(c.height),
      players: String(c.players),
      units: String(c.units),
      frames: String(frames),
      viewportWidth: String(viewportWidth),
      viewportHeight: String(viewportHeight),
    });
    if ("zoom" in c) {
      query.set("surface", "sphere");
      query.set("zoom", String(c.zoom));
    }
    // The benchmark runs during page load; wait for its result, not for the load event.
    await page.goto(`${address}?${query.toString()}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.benchResult ?? window.benchError, undefined, {
      timeout: 300_000,
    });
    const error = await page.evaluate(() => window.benchError);
    if (error) throw new Error(error);
    const result = await page.evaluate(() => window.benchResult);
    if (result) results.push(result);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  `GPU: ${results[0]?.glRenderer ?? "unknown"}, max texture ${String(results[0]?.maxTextureSize)}`,
);
console.log();
console.log(
  "| Map | Viewport | Units | Draw calls | Triangles | Static frame p50 / p95 | CPU submit p50 | Frame with updates p50 / p95 | Rows / texels per update | Full upload frame | First frame | GPU memory |",
);
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of results) {
  console.log(
    `| ${r.map} | ${r.viewport} | ${String(r.units)} | ${String(r.drawCalls)} | ${String(r.triangles)} | ${ms(r.staticFrame.p50)} / ${ms(r.staticFrame.p95)} ms | ${r.staticSubmit.p50.toFixed(2)} ms | ${ms(r.updateFrame.p50)} / ${ms(r.updateFrame.p95)} ms | ${String(r.rowsPerUpdate)} / ${String(r.texelsPerUpdate)} | ${ms(r.fullUploadFrameMs)} ms | ${ms(r.firstFrameMs)} ms | ${(r.gpuBytes / 2 ** 20).toFixed(1)} MiB |`,
  );
}
if (values.json) writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
