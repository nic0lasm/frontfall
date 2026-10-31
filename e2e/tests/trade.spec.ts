import { expect, test } from "@playwright/test";
import { buildAround, startByTheWater } from "./by-the-water.ts";

test("builds a port by the water once the gold allows it (R-BUILD-02)", async ({ page }) => {
  test.setTimeout(150_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // A hundred times the usual gold, so the first port is paid for in seconds of play.
  const start = await startByTheWater(page, "&gold=500");
  const port = page.locator("#build-port");
  // One generous deadline: how fast the gold comes depends on the machine's speed.
  await expect(port).not.toHaveClass(/unaffordable/, { timeout: 90_000 });
  // A port goes on a coast tile of the player's: tried around the start.
  // A refused click gives the mode back; the next port costs more.
  await buildAround(page, start, "KeyO", "#build-port");
  await expect(port).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});

test("puts a bot under embargo from its menu, and the feed says so (R-DIPLO-05)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startByTheWater(page, "");
  const menu = page.locator("#player-menu");
  await page.locator(".leader-button").first().click();
  await expect(menu).toBeVisible();
  const embargo = menu.locator(".menu-action.embargo");
  await expect(embargo).toContainText("Embargo their trade");
  await embargo.click();
  await expect(page.locator(".events-feed")).toContainText("put an embargo on");

  // Lifted from the same menu.
  await page.locator(".leader-button").first().click();
  await expect(menu.locator(".menu-action.embargo")).toBeVisible();
  await menu.locator(".menu-action.embargo").click();
  await expect(page.locator(".events-feed")).toContainText("lifted");
  expect(pageErrors).toEqual([]);
});

test("buys a warship at its port and sends it on patrol (R-UNIT-04)", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const start = await startByTheWater(page, "&gold=1500");
  await expect(page.locator("#build-port")).not.toHaveClass(/unaffordable/, { timeout: 90_000 });
  const port = await buildAround(page, start, "KeyO", "#build-port");
  const warship = page.locator("#build-warship");
  // Ready once built, and paid for.
  await expect(warship).not.toHaveClass(/unaffordable/, { timeout: 90_000 });
  const cost = warship.locator(".build-cost");
  await expect(cost).toHaveText("250K");
  // The port went on the coast closest to the click: a click near it buys there.
  await buildAround(page, port, "KeyV", "#build-warship");
  // The next one costs one more B-COST-WARSHIP.
  await expect(cost).toHaveText("500K");

  // A click on the channel, in the middle of the map, sends it there.
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  await page.keyboard.press("KeyV");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await page.waitForTimeout(500);
  await expect(page.locator(".click-note")).toBeHidden();
  expect(pageErrors).toEqual([]);
});
