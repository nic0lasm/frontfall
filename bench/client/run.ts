import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";
import { summarize } from "../engine/stats.ts";
import { measureSizes, type SizeBudget } from "./size.ts";

/**
 * The client's performance budget (docs/performance.md), on the production
 * build (`bun run build` first). The download sizes are checked against
 * budget.json and fail the command when over. With --trend, a solo game on
 * World is also started in headless Chromium, served by the real game server,
 * and its load times and frame rate are reported: on software rendering they
 * only show a trend, so they never fail the command.
 */
const { values } = parseArgs({
  // `bun run perf:client -- --trend` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    trend: { type: "boolean", default: false },
    // Seconds of frames to record, in the spawn phase and again once bots attack.
    seconds: { type: "string", default: "5" },
    json: { type: "string" },
  },
});

const repository = new URL("../../", import.meta.url);
const dist = fileURLToPath(new URL("apps/client/dist", repository));
const budgets = JSON.parse(
  readFileSync(new URL("budget.json", import.meta.url), "utf8"),
) as SizeBudget[];

const kB = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;
const ms = (value: number): string => `${value.toFixed(0)} ms`;
const lines: string[] = [];

const sizes = measureSizes(dist, budgets);
const over = sizes.filter((s) => s.sent > s.budget);
lines.push("### Client download size", "");
lines.push("| Files | Count | Raw | Sent (gzip) | Brotli | Budget | |");
lines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const s of sizes) {
  lines.push(
    `| ${s.name} | ${String(s.files)} | ${kB(s.raw)} | ${kB(s.sent)} | ${kB(s.brotli)} | ${kB(s.budget)} | ${s.sent > s.budget ? "**over**" : `${String(Math.round((s.sent / s.budget) * 100))} %`} |`,
  );
}
lines.push("");

interface Frames {
  readonly fps: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

let trend: { menu: number; game: number; spawn: Frames; play: Frames } | undefined;
if (values.trend) {
  try {
    trend = await measureInBrowser(Number(values.seconds) * 1000);
  } catch (error) {
    // A trend, not a budget: a browser that fails to play the game does not fail the command.
    const message = `The browser measurement failed: ${String(error).split("\n")[0] ?? ""}`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
    lines.push(message, "");
  }
}
if (trend) {
  lines.push("### Client in headless Chromium (software rendering, trend only)", "");
  lines.push(
    `World with 63 normal bots at 1280×720. Menu shown after ${ms(trend.menu)}, game screen ${ms(trend.game)} after Play.`,
    "",
  );
  lines.push("| Phase | Frames/s | Frame p50 | Frame p95 | Frame max |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const [phase, f] of [
    ["Spawn, panning", trend.spawn],
    ["Bots attacking, panning", trend.play],
  ] as const) {
    lines.push(`| ${phase} | ${f.fps.toFixed(1)} | ${ms(f.p50)} | ${ms(f.p95)} | ${ms(f.max)} |`);
  }
  lines.push("");
}

const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (values.json) writeFileSync(values.json, JSON.stringify({ sizes, trend }, null, 2));
for (const s of over) console.error(`${s.name}: ${kB(s.sent)} is over the ${kB(s.budget)} budget`);
process.exit(over.length > 0 ? 1 : 0);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
  });
}

/** Frame intervals while the camera pans, so that every frame is drawn. */
async function recordFrames(page: Page, duration: number): Promise<Frames> {
  await page.keyboard.down("ArrowRight");
  // A string, not a function: tsx would wrap named functions in a helper the page lacks.
  const times = await page.evaluate<number[]>(`new Promise((resolve) => {
    const times = [];
    const frame = (now) => {
      times.push(now);
      if (now - times[0] < ${String(duration)}) requestAnimationFrame(frame);
      else resolve(times);
    };
    requestAnimationFrame(frame);
  })`);
  await page.keyboard.up("ArrowRight");
  const intervals = times.slice(1).map((t, i) => t - (times[i] as number));
  const frames = summarize(intervals);
  const span = (times.at(-1) as number) - (times[0] as number);
  return {
    fps: (intervals.length / span) * 1000,
    p50: frames.p50,
    p95: frames.p95,
    max: frames.max,
  };
}

async function measureInBrowser(duration: number) {
  const port = await freePort();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const server = spawn(
    process.execPath,
    [fileURLToPath(new URL("apps/server/dist/server.mjs", repository))],
    {
      env: { ...process.env, PORT: String(port), FRONTFALL_STATIC: dist },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  try {
    const base = `http://127.0.0.1:${String(port)}`;
    for (let attempt = 0; ; attempt++) {
      const healthy = await fetch(`${base}/healthz`).then(
        (r) => r.ok,
        () => false,
      );
      if (healthy) break;
      if (attempt > 100) throw new Error("the game server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "en-US" });
    await page.goto(`${base}/?map=world&bots=63&difficulty=normal`);
    await page.locator("#menu").waitFor();
    const menu = await page.evaluate(() => performance.now());
    await page.locator("#player-name").fill("Bench");
    const clicked = await page.evaluate(() => performance.now());
    await page.locator("#play").click();
    await page
      .locator(".banner")
      .filter({ hasText: "choose where you start" })
      .waitFor({ timeout: 60_000 });
    const game = (await page.evaluate(() => performance.now())) - clicked;
    const spawnFrames = await recordFrames(page, duration);
    await page.locator(".banner").filter({ hasText: "to expand" }).waitFor({ timeout: 60_000 });
    // Let the bots spread and attack for a while first.
    await page.waitForTimeout(5_000);
    const playFrames = await recordFrames(page, duration);
    return { menu, game, spawn: spawnFrames, play: playFrames };
  } finally {
    server.kill();
    await browser.close();
  }
}
