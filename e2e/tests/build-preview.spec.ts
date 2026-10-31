import { expect, test, type Page } from "@playwright/test";

/** The player's share of the land, as the HUD shows it, in percent. */
async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/**
 * Starts a solo game with plenty of gold and spawns on the first land a
 * spiral around the middle finds; returns that point, which stays the player's.
 */
async function startRich(page: Page, tap = false): Promise<{ x: number; y: number }> {
  // At ×5 the bots of the 0.9.5 economy may take a slow runner's land before the checks end.
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&speed=2&gold=500");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (let ring = 0; ring < 12; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * 2 * Math.PI;
      const radius = 20 + ring * 25;
      const point = {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
      if (tap) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(150);
      if ((await landShare(page)) > 0) {
        await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
        await expect(page.locator("#build-city")).not.toHaveClass(/unaffordable/, {
          timeout: 60_000,
        });
        return point;
      }
    }
  }
  throw new Error("no land near the middle of the map");
}

test("keys 1 to 9 pick a building, and Shift with a digit sets the attack share", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startRich(page);

  await expect(page.locator("#build-city")).toHaveAttribute("data-num", "1");
  await expect(page.locator("#build-fort")).toHaveAttribute("data-num", "3");
  await expect(page.locator("#build-demolish")).not.toHaveAttribute("data-num");

  await page.keyboard.press("Digit3");
  await expect(page.locator("#build-fort")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Digit1");
  await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#build-fort")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Digit1");
  await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Shift+Digit3");
  await expect(page.locator("#attack-ratio")).toHaveValue("30");
  await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});

test("a build preview shows green on the player's land and red elsewhere, with its price", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const start = await startRich(page);

  await page.keyboard.press("Digit3");
  await page.mouse.move(start.x, start.y);
  const anchor = page.locator(".bp-anchor");
  await expect(anchor).toHaveAttribute("data-ok", "true");
  const card = page.locator(".bp-card");
  await expect(card).toContainText("Fort");
  await expect(card).toContainText("gold");
  await expect(card).toContainText("Click to confirm");
  await expect(card).toContainText("Reach: 25 tiles");
  await expect(page.locator(".bp-reach")).toBeVisible();

  // Out at sea, the reason a click would give.
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  await page.mouse.move(box.x + 6, box.y + 6);
  await expect(anchor).toHaveAttribute("data-ok", "false");
  await expect(card).not.toContainText("Click to confirm");
  await expect(page.locator(".bp-status")).not.toHaveText("");
  await expect(page.locator(".bp-reach")).toBeHidden();

  // The preview builds nothing: the mode stays on, and the fort only goes up on a click.
  await expect(page.locator("#build-fort")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(start.x, start.y);
  await expect(anchor).toHaveAttribute("data-ok", "true");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#build-fort")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".build-preview")).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 780 } });

  test("the first tap shows the preview and the second places the building", async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const start = await startRich(page, true);

    // The tray of buildings opens behind its button on a narrow screen.
    await page.locator(".icon-build").click();
    await page.locator("#build-city").click();
    await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "true");

    await page.touchscreen.tap(start.x, start.y);
    const anchor = page.locator(".bp-anchor");
    await expect(anchor).toHaveAttribute("data-ok", "true");
    await expect(page.locator(".bp-card")).toContainText("Tap again to confirm");
    // Nothing was built by the first tap.
    await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#build-city .build-count")).not.toContainText("1 city");

    await page.touchscreen.tap(start.x, start.y);
    await expect(page.locator("#build-city .build-count")).toContainText("1 city", {
      timeout: 5_000,
    });
    await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "false");

    expect(pageErrors).toEqual([]);
  });

  test("the card's button places it too, wherever the first tap was", async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const start = await startRich(page, true);

    await page.locator(".icon-build").click();
    await page.locator("#build-city").click();
    await page.touchscreen.tap(start.x, start.y);
    await expect(page.locator(".bp-anchor")).toHaveAttribute("data-ok", "true");
    await page.locator(".bp-confirm").click();
    await expect(page.locator("#build-city .build-count")).toContainText("1 city", {
      timeout: 5_000,
    });
    await expect(page.locator("#build-city")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".build-preview")).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
});
