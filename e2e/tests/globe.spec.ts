import { expect, test } from "@playwright/test";

// The globe prototype (ADR 0005), behind ?view=globe.
test("shows the World on a globe, picks tiles on it, and switches to the flat map", async ({
  page,
}) => {
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

  // Space around the planet selects nothing: no reason comes up.
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await page.waitForTimeout(300);
  await expect(page.locator(".click-note")).toBeHidden();
  // The globe starts over the Gulf of Guinea, at latitude and longitude 0.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".click-note")).toContainText("Only land");

  await page.keyboard.press("KeyG");
  await expect(page.locator("#map canvas")).toHaveCount(1);
  await page.keyboard.press("KeyG");
  await expect(page.locator("#map canvas")).toHaveCount(1);
  await expect(page.locator("#map canvas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
