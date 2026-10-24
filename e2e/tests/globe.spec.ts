import { expect, test } from "@playwright/test";

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
