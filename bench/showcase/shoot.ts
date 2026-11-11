/**
 * Captures the showcase (page.ts) at three zooms, on a laptop and a phone, in
 * the software renderer: `pnpm --filter @frontfall/bench showcase -- --out dir --label name`.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    out: { type: "string", default: "showcase-out" },
    label: { type: "string", default: "shot" },
    map: { type: "string", default: "europe" },
    query: { type: "string", default: "" },
    gpu: { type: "boolean", default: false },
    // name:zoom:x:y, comma separated, in place of the three shots on Europe.
    shots: { type: "string" },
    devices: { type: "string", default: "laptop,phone" },
  },
});

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = fileURLToPath(new URL("../../apps/client/public/", import.meta.url));
const server = await createServer({
  root,
  logLevel: "error",
  server: { port: 0, fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
await server.listen();
const address = server.resolvedUrls?.local[0];
if (!address) throw new Error("the showcase server did not start");
mkdirSync(values.out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: values.gpu
    ? ["--enable-gpu", "--ignore-gpu-blocklist"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const devices = [
  { name: "laptop", width: 1440, height: 900, ratio: 1, phone: false },
  { name: "phone", width: 390, height: 844, ratio: 2, phone: true },
].filter((device) => values.devices.split(",").includes(device.name));
// Centre and zoom of each shot, on Europe: the continent, a region, a coast up close.
const shots = values.shots
  ? values.shots.split(",").map((shot) => {
      const [name = "shot", zoom, x, y] = shot.split(":");
      return { name, zoom: Number(zoom), x: Number(x), y: Number(y) };
    })
  : [
      { name: "world", zoom: 1, x: 0.5, y: 0.5 },
      { name: "mid", zoom: 3.2, x: 0.52, y: 0.56 },
      { name: "near", zoom: 11, x: 0.46, y: 0.62 },
    ];
for (const device of devices) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.ratio,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    console.error(error);
  });
  for (const shot of shots) {
    const query = new URLSearchParams({
      map: values.map,
      zoom: String(shot.zoom),
      x: String(shot.x),
      y: String(shot.y),
      public: publicDir,
      ratio: String(device.ratio),
    });
    if (device.phone) query.set("phone", "1");
    for (const [k, v] of new URLSearchParams(values.query)) query.set(k, v);
    await page.goto(`${address}?${query.toString()}`);
    await page.waitForFunction(() => window.showcaseReady === true || window.showcaseError, null, {
      timeout: 180_000,
    });
    const error = await page.evaluate(() => window.showcaseError);
    if (error) throw new Error(error);
    const file = `${values.out}/${values.label}-${device.name}-${shot.name}.png`;
    await page.screenshot({ path: file });
    const time = await page.evaluate(
      () => (window as unknown as { showcaseTime?: number }).showcaseTime,
    );
    console.log(file, time === undefined ? "" : `${time.toFixed(1)} ms`);
  }
  await context.close();
}
await browser.close();
await server.close();
