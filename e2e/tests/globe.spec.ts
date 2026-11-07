import { expect, test, type Page } from "@playwright/test";

// These look at the picture itself: the full map, not the flat one the other specs use.
test.use({ storageState: { cookies: [], origins: [] } });

// The globe prototype (ADR 0005), behind ?view=globe.
test("shows the World on a globe, picks tiles on it, and switches to the flat map", async ({
  page,
  browserName,
}) => {
  // Firefox runs WebGL in software under xvfb here; the globe is not checked there yet.
  test.skip(browserName === "firefox", "globe prototype checked in Chromium only");
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./?map=world&view=globe");
  await page.locator("#play").click();
  await expect(page.locator(".banner")).toContainText("choose where you start", {
    timeout: 30_000,
  });
  await expect(page.locator("#map canvas")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");

  // Space around the planet selects nothing, then the globe, which starts
  // over the Gulf of Guinea at latitude and longitude 0, answers with sea:
  // one ring only, for the second click.
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".click-note")).toContainText("Only land");
  await expect(page.locator(".click-mark")).toHaveCount(1);

  await page.keyboard.press("KeyG");
  await expect(page.locator("#map canvas")).toHaveCount(1);
  await page.keyboard.press("KeyG");
  await expect(page.locator("#map canvas")).toHaveCount(1);
  await expect(page.locator("#map canvas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

/** The game's clock in seconds, from the goal bar. */
const clockOf = async (page: Page): Promise<number> => {
  const text = (await page.locator(".goal-clock").textContent()) ?? "";
  const [minutes, seconds] = text.split(" ")[0]?.split(":").map(Number) ?? [];
  return (minutes ?? 0) * 60 + (seconds ?? 0);
};

/**
 * Presses G, as the player would, and waits for the next frame: the game
 * draws it before this page's own callback runs, and reading a pixel back
 * waits for the graphics card to finish it. The milliseconds from the key
 * to the new view drawn, on the page's clock.
 */
const timedSwitch = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>("#map canvas");
        const gl = canvas?.getContext("webgl2");
        const start = performance.now();
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", key: "g" }));
        requestAnimationFrame(() => {
          gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
          resolve(performance.now() - start);
        });
      }),
  );

// M7-07 (#66): the switch keeps the WebGL context and the input, and takes under 500 ms.
// A time taken on a busy machine says little: CI runs the @timing tests alone, in the
// Performance job, and leaves them out of the sharded end-to-end runs.
test("switches between the globe and the flat map in under 500 ms, and the game goes on @timing", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "timed in Chromium only");
  test.setTimeout(120_000);
  // The test machines draw in software: a frame of 1280 by 720 takes 400 to 800 ms there,
  // whatever the view. A quarter of the pixels times the switch rather than the rasterizer.
  await page.setViewportSize({ width: 640, height: 360 });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./?map=world&bots=4&nations=0&speed=2&view=globe");
  await page.locator("#play").click();
  const map = page.locator("#map");
  await expect(map.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(map).toHaveAttribute("data-view", "globe");
  // Past the spawn phase, so that the clock runs, and the flat map made while the browser was idle.
  await expect.poll(() => clockOf(page), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(map).toHaveAttribute("data-ready", "flat", { timeout: 30_000 });
  const canvas = await map.locator("canvas").elementHandle();

  const timings: number[] = [];
  for (const kind of ["flat", "globe", "flat", "globe", "flat", "globe"]) {
    timings.push(await timedSwitch(page));
    await expect(map).toHaveAttribute("data-view", kind);
    await expect(page).toHaveURL(kind === "globe" ? /view=globe/ : /view=map/);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const median = ((sorted[2] ?? 0) + (sorted[3] ?? 0)) / 2;
  console.log(
    `map and globe switches: ${timings.map((ms) => ms.toFixed(0)).join(", ")} ms, median ${median.toFixed(0)} ms`,
  );
  // A switch can share its frame with a tick of the game or a pause of the garbage collector:
  // the median is what a player gets.
  expect(median).toBeLessThan(500);

  // The same canvas, so the same context, and the game goes on.
  await expect(map.locator("canvas")).toHaveCount(1);
  expect(await map.locator("canvas").evaluate((element, kept) => element === kept, canvas)).toBe(
    true,
  );
  const before = await clockOf(page);
  await expect.poll(() => clockOf(page), { timeout: 30_000 }).toBeGreaterThan(before);
  expect(pageErrors).toEqual([]);
});
