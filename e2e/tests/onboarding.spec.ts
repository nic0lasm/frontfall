import { expect, test } from "@playwright/test";
import { spiral, startByTheWater } from "./by-the-water.ts";

/** Starts a solo game on a small map, as a new player does. */
async function startSolo(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
}

test("the help lists every building with its key, cost and where it goes", async ({ page }) => {
  await startSolo(page);
  await expect(page.locator("#build-port .build-key").first()).toHaveText("O");
  // Costs come with the first update of the game.
  await expect(page.locator("#build-port .build-cost")).toHaveText(/\d/);

  await page.keyboard.press("Shift+Slash");
  const help = page.locator("#help-panel");
  await expect(help).toBeVisible();
  await expect(help).toContainText("How to play");
  const port = help.locator(".help-build.build-port");
  await expect(port).toContainText("on your coast");
  await expect(port.locator("kbd").first()).toHaveText("O");
  await expect(port.locator(".help-cost")).toHaveText(/\d/);
  // One row per build button.
  await expect(help.locator(".help-build")).toHaveCount(
    await page.locator(".build-button").count(),
  );

  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await page.keyboard.press("KeyH");
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Back to the game" }).click();
  await expect(help).toHaveCount(0);
});

test("the first steps follow the player, and stay hidden once put away", async ({ page }) => {
  await startSolo(page);
  const guide = page.locator("#guide");
  await expect(guide).toHaveAttribute("data-step", "start");
  await expect(guide).toContainText("place your start");

  // Next moves on without doing the step; the guide never blocks the game.
  await page.locator("#guide-next").click();
  await expect(guide).toHaveAttribute("data-step", "expand");
  await page.locator("#guide-next").click();
  await expect(guide).toHaveAttribute("data-step", "troops");
  await expect(guide).toContainText("slider");
  // The step lights the slider, and moving it is what moves the guide on.
  await expect(page.locator("#attack-ratio")).toHaveClass(/guide-target/);
  await page.locator("#attack-ratio").fill("50");
  await expect(guide).toHaveAttribute("data-step", "build");
  await expect(guide).toContainText("City");
  await expect(page.locator("#build-city")).toHaveClass(/guide-target/);
  await expect(page.locator("#attack-ratio")).not.toHaveClass(/guide-target/);
  await page.locator("#guide-next").click();
  await expect(guide).toHaveAttribute("data-step", "defend");
  await expect(guide).toContainText("Fort");
  await expect(page.locator("#build-fort")).toHaveClass(/guide-target/);

  await page.locator("#guide-hide").click();
  await expect(guide).toHaveCount(0);
  await page.locator("#leave").click();
  await startSolo(page);
  await expect(page.locator("#hud")).toBeVisible();
  await expect(guide).toHaveCount(0);

  // The help brings them back.
  await page.locator("#help").click();
  await page.getByRole("button", { name: "Show the first steps again" }).click();
  await expect(guide).toHaveAttribute("data-step", "start");
});

test("a refused build names what was refused", async ({ page }) => {
  await startSolo(page);
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  // Water in a corner of the view: never a place for a city.
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  await page.keyboard.press("KeyC");
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await expect(page.locator("#click-note")).toContainText(/^City: /);
});

test("the tutorial is a guided game of its own, even after the first steps were put away", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("frontfall.guide", "done");
  });
  await page.goto("./");
  await expect(page.locator("#tutorial")).toBeVisible();
  await page.locator("#tutorial").click();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#guide")).toHaveAttribute("data-step", "start");

  // Putting the guide away works there as in any game.
  await page.locator("#guide-hide").click();
  await expect(page.locator("#guide")).toHaveCount(0);
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the tutorial button is read, and reached, with the keyboard", async ({ page }) => {
    await page.goto("./");
    const button = page.locator("#tutorial");
    await expect(button).toHaveText("Tutoriel");
    await button.focus();
    await expect(button).toBeFocused();
    await expect(page.locator("#tutorial-hint")).toContainText("guidée");
  });
});

test("the line about expanding goes away for good after the first attack", async ({ page }) => {
  const banner = page.locator(".banner");
  const start = await startByTheWater(page, "");
  // The first order: expand into land beside the start, unless the spawn clicks already did.
  for (const point of spiral(start, 6, 6)) {
    if (!(await banner.textContent())?.includes("to expand")) break;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
  }
  // Once the attack is over the line does not come back, in this game or the next.
  await expect(banner).toBeHidden({ timeout: 30_000 });
  // Left from the menu, so that the page opened next does not offer this game back.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("#leave").click();
  await expect(page.locator("#menu")).toBeVisible();
  await page.goto("./?map=strait&bots=1&difficulty=easy&nations=0&speed=5");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await page.mouse.click(start.x, start.y);
  await expect(page.locator(".stats .stat").nth(2).locator(".stat-value")).not.toHaveText("0%");
  await expect(banner).toBeHidden({ timeout: 30_000 });
});
