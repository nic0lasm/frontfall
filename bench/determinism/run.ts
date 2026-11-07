import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { MapDescription, ReplayResult } from "@frontfall/engine";
import { chromium, firefox, webkit, type BrowserType, type Page } from "playwright-core";
import { createServer } from "vite";
import { playScenario, type ScenarioResult } from "./scenario.ts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    map: { type: "string", default: "world" },
    ticks: { type: "string", default: "10000" },
    // Browsers to run the scenario and the golden replays in, as CI does.
    browsers: { type: "string", default: "chromium,firefox,webkit" },
  },
});
const ticks = Number(values.ticks);
if (!Number.isInteger(ticks) || ticks < 1) {
  console.error("--ticks must be a positive integer");
  process.exit(2);
}

const repository = fileURLToPath(new URL("../..", import.meta.url));
const maps = new URL("../../apps/client/public/maps/", import.meta.url);
const bytes = readFileSync(new URL(`${values.map}.bin`, maps));
const manifest = JSON.parse(
  readFileSync(new URL(`${values.map}.json`, maps), "utf8"),
) as MapDescription;

const runs: { name: string; result: ScenarioResult; seconds: number }[] = [];
const goldenFailures: string[] = [];
const timed = async (name: string, play: () => Promise<ScenarioResult> | ScenarioResult) => {
  const start = performance.now();
  const result = await play();
  runs.push({ name, result, seconds: (performance.now() - start) / 1000 });
  console.log(
    `${name}: ${hex(result.hashes.at(-1) ?? 0)} in ${(runs.at(-1)?.seconds ?? 0).toFixed(1)} s`,
  );
};
const hex = (hash: number): string => hash.toString(16).padStart(8, "0");

await timed("Node, first run", () => playScenario(new Uint8Array(bytes), manifest, ticks));
await timed("Node, second run", () => playScenario(new Uint8Array(bytes), manifest, ticks));

// Bun is another engine than V8: the same scenario in its own process (the server's
// production runtime), compared with the Node runs below.
await timed("Bun", () => {
  const out = execFileSync(
    process.env.BUN_PATH ?? "bun",
    [
      fileURLToPath(new URL("bun-scenario.ts", import.meta.url)),
      fileURLToPath(maps),
      values.map,
      String(ticks),
    ],
    { encoding: "utf8", maxBuffer: 1 << 24 },
  );
  return JSON.parse(out) as ScenarioResult;
});

const server = await createServer({
  root: fileURLToPath(new URL(".", import.meta.url)),
  logLevel: "error",
  server: { port: 0, fs: { allow: [repository] } },
});
await server.listen();
const address = server.resolvedUrls?.local[0];
if (!address) throw new Error("the determinism page server did not start");
const engines: Record<string, { label: string; type: BrowserType; path: string | undefined }> = {
  chromium: { label: "Chromium", type: chromium, path: process.env.CHROMIUM_PATH },
  firefox: { label: "Firefox", type: firefox, path: process.env.FIREFOX_PATH },
  webkit: { label: "WebKit", type: webkit, path: process.env.WEBKIT_PATH },
};
try {
  for (const name of values.browsers.split(",").filter(Boolean)) {
    const engine = engines[name];
    if (!engine) throw new Error(`unknown browser ${name}`);
    const browser = await engine.type.launch({
      executablePath: engine.path ?? engine.type.executablePath(),
    });
    try {
      await playInBrowser(await browser.newPage(), `${engine.label} worker`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

async function playInBrowser(page: Page, label: string): Promise<void> {
  await page.goto(address as string);
  await page.waitForFunction(() => typeof window.playScenario === "function");
  const mapUrl = `/@fs${fileURLToPath(new URL(values.map, maps))}`;
  await timed(label, () =>
    page.evaluate(([url, count]) => window.playScenario(url, count), [mapUrl, ticks] as const),
  );
  // The golden replays the bench tests pin in Node, played again in the browser.
  const replays = new URL("../../packages/engine/test/replays/", import.meta.url);
  for (const file of readdirSync(replays).filter((entry) => entry.endsWith(".json"))) {
    const report = JSON.parse(readFileSync(new URL(file, replays), "utf8")) as {
      map: { id: string };
      ticks: number;
    };
    const url = `/@fs${fileURLToPath(new URL(report.map.id, maps))}`;
    const start = performance.now();
    const result: ReplayResult = await page.evaluate(
      ([mapPath, data]) => window.playReplay(mapPath, data),
      [url, report] as const,
    );
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    if (result.firstLocalMismatch || result.ticks !== report.ticks) {
      goldenFailures.push(
        `${label} parts from ${file} at tick ${String(result.firstLocalMismatch?.tick ?? result.ticks)}`,
      );
    }
    console.log(`${label}, ${file}: ${String(result.ticks)} ticks in ${seconds} s`);
  }
}

const [reference, ...others] = runs;
if (!reference) throw new Error("no run");
let same = true;
for (const other of others) {
  const at = reference.result.hashes.findIndex((hash, i) => other.result.hashes[i] !== hash);
  if (at === -1) continue;
  same = false;
  console.error(`${other.name} differs from ${reference.name} by tick ${String((at + 1) * 1000)}`);
}
for (const failure of goldenFailures) console.error(failure);
if (goldenFailures.length > 0) same = false;
console.log(`tiles: ${reference.result.tiles.join(", ")}`);
if (!same) process.exit(1);
console.log(
  `${String(runs.length)} runs agree after ${String(ticks)} ticks, and every browser plays the golden replays to their hashes.`,
);
