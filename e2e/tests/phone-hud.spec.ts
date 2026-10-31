import { expect, test } from "@playwright/test";

// The narrowest phones still sold, in French, whose costs are the longest ("1,5 M").
test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, locale: "fr-FR" });

test.setTimeout(90_000);

test("fits every build button and its cost on a narrow phone", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=1&nations=0");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  // The doctrine cards cover the bottom of a narrow phone until the spawn phase ends (R-DOCTRINE-01).
  await expect(page.locator(".doctrine-picker")).toBeHidden({ timeout: 60_000 });
  // The buildings sit behind a button on a phone.
  await expect(page.locator(".build")).toBeHidden();
  await page.locator("#build-toggle").click();
  await expect(page.locator("#build-heavyMissile .build-cost")).toHaveText(/\S/);

  const panel = await page.locator(".build").boundingBox();
  if (!panel) throw new Error("no build panel");
  expect(panel.x + panel.width).toBeLessThanOrEqual(320 - 12);
  for (const button of await page.locator(".build-button:visible").all()) {
    const box = await button.boundingBox();
    const cost = button.locator(".build-cost");
    if (!box) throw new Error("a build button has no size");
    if ((await cost.count()) === 0) continue;
    const text = await cost.boundingBox();
    if (!text) throw new Error("a cost has no size");
    expect(text.x).toBeGreaterThanOrEqual(box.x);
    expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width);
  }
});
