import { expect, test, type Locator, type Page } from "@playwright/test";

/** Presses land on a spiral around the middle of the map until some is the player's. */
async function spawn(page: Page): Promise<void> {
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (let ring = 0; ring < 12; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * 2 * Math.PI;
      await page.mouse.click(
        centre.x + Math.cos(angle) * (20 + ring * 25),
        centre.y + Math.sin(angle) * (20 + ring * 25),
      );
      await page.waitForTimeout(150);
      const land = await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent();
      if ((Number.parseFloat((land ?? "").replace(",", ".")) || 0) > 0) return;
    }
  }
  throw new Error("no land near the middle of the map");
}

async function middleOf(slider: Locator): Promise<{ x: number; y: number }> {
  const box = await slider.boundingBox();
  if (!box) throw new Error("the slider has no size");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function start(page: Page): Promise<void> {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await spawn(page);
  await expect(page.locator("#work-share")).toBeEnabled();
  // The doctrine cards cover the sliders until the spawn phase ends (R-DOCTRINE-01).
  await expect(page.locator(".doctrine-picker")).toBeHidden({ timeout: 60_000 });
}

// Each game waits out the spawn phase, which the doctrine cards cover the sliders for.
test.setTimeout(90_000);

test.describe("a press anywhere on a slider sets it", () => {
  test("a single mouse click on the middle of the track", async ({ page }) => {
    await start(page);
    const attack = page.locator("#attack-ratio");
    const middle = await middleOf(attack);
    await page.mouse.click(middle.x, middle.y);
    expect(Number(await attack.inputValue())).toBeGreaterThanOrEqual(48);
    expect(Number(await attack.inputValue())).toBeLessThanOrEqual(52);

    // The work share runs from 0 to 80 %: its middle is 40 %.
    const work = page.locator("#work-share");
    const workMiddle = await middleOf(work);
    await page.mouse.click(workMiddle.x, workMiddle.y);
    expect(Number(await work.inputValue())).toBeGreaterThanOrEqual(38);
    expect(Number(await work.inputValue())).toBeLessThanOrEqual(42);
  });

  test("dragging follows the pointer and the keyboard still works", async ({ page }) => {
    await start(page);
    const attack = page.locator("#attack-ratio");
    const box = await attack.boundingBox();
    if (!box) throw new Error("the slider has no size");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, y, { steps: 5 });
    await page.mouse.up();
    // A short track puts the thumb a little further than the pointer: allow for it.
    expect(Number(await attack.inputValue())).toBeGreaterThanOrEqual(70);
    expect(Number(await attack.inputValue())).toBeLessThanOrEqual(90);

    const before = Number(await attack.inputValue());
    await attack.press("ArrowLeft");
    expect(Number(await attack.inputValue())).toBe(before - 1);
  });
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("one tap on the middle of the track", async ({ page }) => {
    await start(page);
    const attack = page.locator("#attack-ratio");
    const middle = await middleOf(attack);
    await page.touchscreen.tap(middle.x, middle.y);
    expect(Number(await attack.inputValue())).toBeGreaterThanOrEqual(47);
    expect(Number(await attack.inputValue())).toBeLessThanOrEqual(54);
  });
});
