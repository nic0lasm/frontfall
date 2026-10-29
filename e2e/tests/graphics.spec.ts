import { devices, expect, test } from "@playwright/test";

// A phone with a finger, a notch of pixels (ratio 3) and the picture the player gets by default.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
test.use({
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch,
  storageState: { cookies: [], origins: [] },
});

test("a phone draws a lighter map by itself, and the player can ask for another", async ({
  page,
  browserName,
}) => {
  // Playwright emulates mobile touch screens in Chromium only.
  test.skip(browserName === "firefox", "no touch emulation in Firefox");
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // A runner with few cores would pass for a weak phone: this one is an ordinary one.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { value: 6 });
    Object.defineProperty(navigator, "deviceMemory", { value: 8 });
  });

  await page.goto("./?map=skirmish&bots=1&perf");
  await page.locator("#play").tap();
  await expect(page.locator("#map canvas")).toBeVisible();
  // Auto on a phone: the full picture, a little less sharp than a laptop's.
  await expect(page.locator(".perf-report-text")).toContainText("cap 1.5 flat false");
  await expect(page.locator(".perf-report-copy")).toBeVisible();
  expect(pageErrors).toEqual([]);

  await page.goto("./");
  await page.locator("#open-accessibility").tap();
  await page.locator("#graphics").selectOption("saver");
  await page.goto("./?map=skirmish&bots=1&perf");
  await page.locator("#play").tap();
  await expect(page.locator("#map canvas")).toBeVisible();
  await expect(page.locator(".perf-report-text")).toContainText("profile saver flat true");
  expect(pageErrors).toEqual([]);
});
