import { expect, test } from "@playwright/test";

test("a press on the figures of the bar says what they are made of", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=1&nations=0");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();

  const gold = page.locator(".stats .stat-help").nth(1);
  await expect(gold).toHaveAttribute("title", /\S/);
  await gold.click();
  await expect(page.locator("#build-tip")).toBeVisible();
  await expect(page.locator("#build-tip")).toContainText(/\d/);
  // The same words are there for the pointer, without a press.
  await expect(gold).toHaveAttribute("title", /\S/);

  // The keyboard reaches them too.
  await page.locator("#build-tip").evaluate((tip) => {
    tip.setAttribute("hidden", "");
  });
  await gold.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#build-tip")).toBeVisible();
});
