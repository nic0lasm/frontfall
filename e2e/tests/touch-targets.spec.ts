import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true });

const SIZES = [
  { width: 390, height: 780 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
  { width: 740, height: 360 },
];

async function measure(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no size`);
  return box;
}

/** Taps land on a spiral around the middle of the map until some is the player's. */
async function spawn(page: Page): Promise<void> {
  const box = await measure(page, "#map");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (let ring = 0; ring < 12; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * 2 * Math.PI;
      await page.touchscreen.tap(
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

for (const size of SIZES) {
  test(`the attack slider is 44 px wide at ${String(size.width)}x${String(size.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("./?map=skirmish&bots=2&nations=0&difficulty=easy&speed=5&gold=500");
    await page.locator("#play").tap();
    await expect(page.locator("#attack-ratio")).toBeVisible();
    const closed = await measure(page, "#attack-ratio");
    await page.locator("#build-toggle").tap();
    await page.waitForTimeout(300);
    const open = await measure(page, "#attack-ratio");
    expect(closed.width).toBeGreaterThanOrEqual(44);
    expect(open.width).toBeGreaterThanOrEqual(44);
  });
}

for (const size of SIZES) {
  test(`the first steps keep off the build tray at ${String(size.width)}x${String(size.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("./?map=skirmish&bots=2&nations=0&difficulty=easy&speed=5&gold=500");
    await page.locator("#play").tap();
    await expect(page.locator(".guide")).toBeVisible();
    await page.locator("#build-toggle").tap();
    await expect(page.locator(".build")).toBeVisible();
    // A short window hides the banner while the tray is open; a tall one moves it clear.
    if (size.height < 560) {
      await expect(page.locator(".guide")).toBeHidden();
      return;
    }
    const tray = await measure(page, ".build");
    const guide = await measure(page, ".guide");
    const apart =
      guide.y + guide.height <= tray.y ||
      tray.y + tray.height <= guide.y ||
      guide.x + guide.width <= tray.x ||
      tray.x + tray.width <= guide.x;
    expect(apart, `guide ${JSON.stringify(guide)} tray ${JSON.stringify(tray)}`).toBe(true);
  });

  test(`a finger reaches the tray, a building and the pause at ${String(size.width)}x${String(size.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("./?map=skirmish&bots=2&nations=0&difficulty=easy&speed=5&gold=500");
    await page.locator("#play").tap();
    await spawn(page);
    await expect(page.locator("#build-city")).not.toHaveClass(/unaffordable/, { timeout: 60_000 });
    await page.locator("#build-toggle").tap();
    await page.locator("#build-city").tap();
    await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#pause").tap();
    await expect(page.locator(".overlay.paused")).toBeVisible();
  });
}
