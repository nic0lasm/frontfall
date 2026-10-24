import { expect, test, type Page } from "@playwright/test";

/**
 * A point of the page in the middle of a patch of `color` ("rgb(r, g, b)"),
 * give or take the relief shading; undefined if there is none.
 */
async function findColor(page: Page, color: string): Promise<{ x: number; y: number } | undefined> {
  const png = (await page.screenshot({ scale: "css" })).toString("base64");
  const [r, g, b] = (color.match(/\d+/g) ?? []).map(Number);
  // The suite has no DOM types: the search runs in the page, as a string.
  return page.evaluate<{ x: number; y: number } | undefined>(`(async (png, r, g, b) => {
    const image = new Image();
    image.src = "data:image/png;base64," + png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    const near = (x, y) => {
      const i = (y * width + x) * 4;
      return Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 60;
    };
    for (let y = 4; y < height - 4; y += 2) {
      for (let x = 4; x < width - 4; x += 2) {
        if (!near(x, y) || !near(x - 4, y) || !near(x + 4, y) || !near(x, y - 4) || !near(x, y + 4)) {
          continue;
        }
        // The map, not the same colour in a panel over it.
        if (document.elementFromPoint(x, y)?.closest("#map")) return { x, y };
      }
    }
    return undefined;
  })(${JSON.stringify(png)}, ${String(r)}, ${String(g)}, ${String(b)})`);
}

/** Starts a solo game on the skirmish map and spawns near the middle; returns the map's box. */
async function startGame(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&speed=5");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  // Spawn on the first land tile a spiral from the middle finds.
  for (let i = 0; i < 96; i++) {
    const angle = ((i % 8) / 8) * 2 * Math.PI;
    const radius = 20 + Math.floor(i / 8) * 25;
    await page.mouse.click(
      box.x + box.width / 2 + Math.cos(angle) * radius,
      box.y + box.height / 2 + Math.sin(angle) * radius,
    );
    await page.waitForTimeout(150);
    const land =
      (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
    if ((Number.parseFloat(land.replace(",", ".")) || 0) > 0) break;
  }
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  return box;
}

test("asks a bot for an alliance from the leaderboard, then betrays it (R-DIPLO)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startGame(page);

  // A bot accepts a smaller player (R-BOT-10): the player stays put while the bots grow.
  const leader = page.locator(".leader-button").first();
  const menu = page.locator("#player-menu");
  const ally = page.locator(".leader .badge-ally").first();
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline && !(await ally.isVisible())) {
    if (!(await menu.isVisible())) await leader.click();
    const ask = menu.locator(".menu-action.ask");
    if ((await ask.count()) > 0 && (await ask.isEnabled())) await ask.click();
    await page.waitForTimeout(500);
  }
  await expect(ally).toBeVisible();
  await expect(page.locator(".event-feed")).toContainText("are now allies");

  // Betraying asks once more first.
  if (!(await menu.isVisible()))
    await page.locator(".leader-button:has(.badge-ally:visible)").click();
  await menu.locator(".menu-action.betray").click();
  await expect(menu.locator(".menu-action.betray")).toContainText("Confirm");
  await menu.locator(".menu-action.betray").click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".event-feed")).toContainText("betrayed");
  await expect(page.locator(".leader.you .badge-traitor")).toBeVisible();
  await expect(page.locator(".leader .badge-ally:visible")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("closes the player menu with Esc before pausing", async ({ page }) => {
  await startGame(page);
  await page.locator(".leader-button").first().click();
  const menu = page.locator("#player-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".menu-action").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".overlay.paused")).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 400, height: 760 } });

  test("opens a player's menu with a long press, and does not attack (R-DIPLO-01)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startGame(page);
    const menu = page.locator("#player-menu");
    // Zoomed out, the bots' land is in view, with their names over it.
    // Keys move the camera while held.
    await page.keyboard.down("Minus");
    await page.waitForTimeout(2000);
    await page.keyboard.up("Minus");
    // A bot's land, found on screen by its colour in the leaderboard.
    const bot = page.locator(".leader-button").first();
    const name = (await bot.locator(".leader-name").textContent()) ?? "";
    const color = await page.evaluate<string>(
      `getComputedStyle(document.querySelector(".leader-button .swatch")).backgroundColor`,
    );
    // A tall screen shows the map's whole height but not its width: pan east, then west.
    let at = await findColor(page, color);
    for (let i = 0; i < 24 && !at; i++) {
      const key = i < 8 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(400);
      await page.keyboard.up(key);
      at = await findColor(page, color);
    }
    if (!at) throw new Error(`no land of ${name} on screen`);
    const { x, y } = at;
    // Synthetic pointer events carry their own time; a string, as the tests are not compiled for the DOM.
    await page.evaluate(`(async () => {
      const map = document.querySelector("#map");
      const init = { pointerId: 7, pointerType: "touch", clientX: ${String(x)}, clientY: ${String(y)}, bubbles: true };
      map.dispatchEvent(new PointerEvent("pointerdown", init));
      await new Promise((resolve) => setTimeout(resolve, 600));
      map.dispatchEvent(new PointerEvent("pointerup", init));
    })()`);
    await expect(page.locator(".attacks")).toBeHidden();
    await expect(menu.locator("h2")).toHaveText(name);
    await expect(menu).toBeVisible();
    await expect(menu.locator(".menu-action.ask")).toBeVisible();
    // The menu stays on screen on a phone.
    const rect = await menu.boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= 400).toBe(true);
  });
});
