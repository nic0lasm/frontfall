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
  await expect(guide).toHaveAttribute("data-step", "doctrine");
  await expect(guide).toContainText("doctrine");
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
  // The price of the building, and how far the player's gold is from it.
  await expect(guide.locator(".guide-meter")).toBeVisible();
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
  // It opens on what the game is, with the clock stopped behind it.
  const intro = page.locator("#tutorial-intro");
  await expect(intro).toBeVisible();
  await expect(intro).toContainText("Frontfall in five minutes");
  await intro.getByRole("button", { name: "Start" }).click();
  await expect(intro).toHaveCount(0);
  await expect(page.locator("#guide")).toHaveAttribute("data-step", "start");

  // Putting the guide away works there as in any game.
  await page.locator("#guide-hide").click();
  await expect(page.locator("#guide")).toHaveCount(0);
});

test("the tutorial goes through every step, says goodbye, and leads to a real game", async ({
  page,
}) => {
  await page.goto("./?map=skirmish&bots=1&difficulty=easy");
  // A real game of the player's own setup: not the tutorial's strait.
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("#leave").click();
  await page.locator("#tutorial").click();
  await page.locator("#tutorial-intro").getByRole("button", { name: "Start" }).click();

  const guide = page.locator("#guide");
  const steps = [
    "start",
    "doctrine",
    "expand",
    "troops",
    "work",
    "citystates",
    "build",
    "port",
    "defend",
    "players",
    "diplomacy",
    "missiles",
    "win",
  ];
  for (const [index, step] of steps.entries()) {
    await expect(guide).toHaveAttribute("data-step", step);
    await expect(guide).toContainText(`Step ${String(index + 1)}/${String(steps.length)}`);
    if (index < steps.length - 1) await page.locator("#guide-next").click();
  }
  // Nothing in it states a figure of the balance but the share that wins.
  await expect(guide).toContainText("75 %");
  await page.locator("#guide-next").click();
  await expect(guide).toHaveCount(0);
  const outro = page.locator("#tutorial-outro");
  await expect(outro).toBeVisible();
  await expect(outro).toContainText("You know the game");
  await expect(outro.locator("li")).toHaveCount(5);
  // The game waits behind it; staying puts it back in motion.
  await outro.getByRole("button", { name: "Keep playing here" }).click();
  await expect(outro).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".overlay.paused")).toHaveCount(0);
});

test("the tutorial's last word starts a real game", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=1&difficulty=easy");
  await page.locator("#tutorial").click();
  await page.locator("#tutorial-intro").getByRole("button", { name: "Start" }).click();
  for (let step = 0; step < 13; step++) await page.locator("#guide-next").click();
  // The practice game runs at double speed.
  await expect(page.locator("#speed")).toContainText("2");
  await page.locator("#tutorial-outro").getByRole("button", { name: "Play a real game" }).click();
  await expect(page.locator("#tutorial-outro")).toHaveCount(0);
  // The menu's own setup, at the normal pace, and no introduction.
  await expect(page.locator("#speed")).toContainText("1");
  await expect(page.locator("#tutorial-intro")).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
});

test("the tutorial's introduction can send the player back to the menu", async ({ page }) => {
  await page.goto("./");
  await page.locator("#tutorial").click();
  await page.getByRole("button", { name: "Back to the menu" }).click();
  await expect(page.locator("#menu")).toBeVisible();
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the tutorial button is read, and reached, with the keyboard", async ({ page }) => {
    await page.goto("./");
    const button = page.locator("#tutorial");
    await expect(button).toHaveText("Tutoriel · 5 min");
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

for (const viewport of [
  { width: 390, height: 780 },
  { width: 360, height: 640 },
]) {
  test.describe(`on a ${String(viewport.width)} by ${String(viewport.height)} phone`, () => {
    test.use({ viewport, hasTouch: true });

    test("the tutorial's card and the doctrine cards leave the banner and the sliders in sight", async ({
      page,
    }) => {
      // At ×1 the placement phase lasts a full minute: a slow browser cannot outrun it.
      await page.goto("./?speed=1");
      await page.locator("#tutorial").click();
      await page.locator("#tutorial-intro").getByRole("button", { name: "Start" }).click();
      // The game answers once its terrain and its first update are in: slow in a software browser.
      const picker = page.locator(".doctrine-picker");
      await expect(picker).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("#guide")).toBeVisible();
      await expect(page.locator(".banner")).toBeVisible();
      await expect(page.locator("#attack-ratio")).toBeVisible();
      const box = async (selector: string) => {
        const found = await page.locator(selector).first().boundingBox();
        if (!found) throw new Error(`${selector} has no size`);
        return found;
      };
      const banner = await box(".banner");
      const guide = await box("#guide");
      const cards = await box(".doctrine-picker");
      const slider = await box("#attack-ratio");
      // The guide sits under the banner, and above the cards, which sit above the sliders.
      expect(guide.y).toBeGreaterThanOrEqual(banner.y + banner.height);
      expect(guide.y + guide.height).toBeLessThanOrEqual(cards.y);
      expect(cards.y + cards.height).toBeLessThanOrEqual(slider.y);
    });
  });
}
