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

/** Waits for the page to draw `count` frames. */
async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    let left = ${String(count)};
    const next = () => (--left > 0 ? requestAnimationFrame(next) : resolve());
    requestAnimationFrame(next);
  })`);
}

/** The land of the player at this screen, in % of the map, as the HUD shows it. */
async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/**
 * Starts a solo game on the skirmish map against `bots` bots and spawns near
 * the middle; returns the point of the page where the player spawned.
 */
async function startGame(
  page: Page,
  bots = 2,
  extra = "",
  speed = 5,
): Promise<{ x: number; y: number }> {
  await page.goto(
    `./?map=skirmish&bots=${String(bots)}&difficulty=easy&nations=0&speed=${String(speed)}${extra}`,
  );
  await page.locator("#play").click();
  // A game that cannot start says why in a notice: the failure then names it.
  await expect(page.locator("#map, .notice").first()).toBeVisible();
  const notice = page.locator(".notice");
  if (await notice.isVisible()) throw new Error(`no game: ${(await notice.textContent()) ?? ""}`);
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  // Spawn on the first land tile a spiral from the middle finds.
  let at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (let i = 0; i < 96; i++) {
    const angle = ((i % 8) / 8) * 2 * Math.PI;
    const radius = 20 + Math.floor(i / 8) * 25;
    at = {
      x: box.x + box.width / 2 + Math.cos(angle) * radius,
      y: box.y + box.height / 2 + Math.sin(angle) * radius,
    };
    await page.mouse.click(at.x, at.y);
    const spawned = await expect
      .poll(() => landShare(page), { timeout: 1000 })
      .toBeGreaterThan(0)
      .then(
        () => true,
        () => false,
      );
    if (spawned) break;
  }
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  return at;
}

test("asks a bot for an alliance from the leaderboard, then betrays it (R-DIPLO)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // One bot, which grows while the player stays put: it accepts a smaller player (R-BOT-10).
  // It also wins within half a minute at ×5 (the betrayal is disabled once a game is won), which
  // a loaded runner takes to the end: ×2 leaves it more than a minute.
  await startGame(page, 1, "", 2);
  const menu = page.locator("#player-menu");
  const ally = page.locator(".leader-button .badge-ally");
  await page.locator(".leader-button").click();
  const ask = menu.locator(".menu-action.ask");
  await expect(ask).toBeEnabled();
  await ask.click();
  // Disabled while it waits, or already gone if the bot answered in the meantime.
  await expect(async () => {
    if ((await ask.count()) > 0) expect(await ask.isDisabled()).toBe(true);
  }).toPass();
  // The bot answers at its next decision, within B-BOT-INTERVAL (5 s of game time).
  await expect(ally).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".events-feed")).toContainText("are now allies");

  // Betraying asks once more first.
  await expect(menu).toBeVisible();
  await menu.locator(".menu-action.betray").click();
  await expect(menu.locator(".menu-action.betray")).toContainText("Confirm");
  await menu.locator(".menu-action.betray").click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".events-feed")).toContainText("betrayed");
  await expect(page.locator(".leader.you .badge-traitor")).toBeVisible();
  await expect(page.locator(".leader .badge-ally:visible")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("sends a bot a gift of gold, in a game without silos (R-DIPLO-06, R-MODE-03)", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startGame(page, 1, "&off=silo&gold=500");
  await expect(page.locator("#build-city")).toBeVisible();
  await expect(page.locator("#build-silo")).toBeHidden();
  await expect(page.locator("#build-missile")).toBeHidden();
  await page.keyboard.press("KeyL");
  await expect(page.locator("#build-silo")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".leader-button").click();
  const menu = page.locator("#player-menu");
  const gold = menu.locator(".menu-action.gift-gold");
  await expect(gold).toContainText("of your gold");
  await expect(gold).toBeEnabled({ timeout: 10_000 });
  await gold.click();
  await expect(page.locator(".events-feed")).toContainText("sent a gift to");
  expect(pageErrors).toEqual([]);
});

test("leaves warships and embargoes out with ports (R-MODE-03)", async ({ page }) => {
  await startGame(page, 1, "&off=port");
  await expect(page).toHaveURL(/off=port%2Cwarship/);
  await expect(page.locator("#build-port")).toBeHidden();
  await expect(page.locator("#build-warship")).toBeHidden();
  await page.locator(".leader-button").click();
  const menu = page.locator("#player-menu");
  await expect(menu.locator(".menu-action.gift-gold")).toBeVisible();
  await expect(menu.locator(".menu-action.embargo")).toHaveCount(0);
});

test("sends a bot a quick message, which the feed shows (R-DIPLO-07)", async ({ page }) => {
  await startGame(page, 1);
  await page.locator(".leader-button").click();
  const menu = page.locator("#player-menu");
  await menu.locator(".menu-action.messages").click();
  await expect(menu.locator(".quick-phrase")).toHaveCount(12);
  await menu.locator(".quick-phrase").first().click();
  await expect(menu.locator(".quick-phrase")).toHaveCount(0);
  await expect(page.locator(".events-feed")).toContainText("Hello!");
});

test("a feed line with a place centres the map on it, and stays while the pointer is on it", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startGame(page, 1);
  await page.locator(".leader-button").click();
  const menu = page.locator("#player-menu");
  await menu.locator(".menu-action.messages").click();
  await menu.locator(".quick-phrase").first().click();
  const line = page.locator(".events-feed button.feed-entry").first();
  await expect(line).toContainText("Hello!");
  await expect(line).toHaveAttribute("title", "Centre the map on it");
  await line.click();
  expect(pageErrors).toEqual([]);
  // The pointer rests on the feed: the line outlives its 8 seconds.
  await line.hover();
  await page.waitForTimeout(9000);
  await expect(line).toBeVisible();
});

test("shows the card of the player whose land the mouse rests on", async ({ page }) => {
  const spawn = await startGame(page, 1);
  // The mouse is where the game spawned the player: a move of a pixel stays on their land.
  await page.mouse.move(spawn.x + 1, spawn.y + 1);
  const tip = page.locator("#player-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("You");
  await expect(tip).toContainText("troops");
  await page.mouse.move(spawn.x + 300, spawn.y + 300);
  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden();
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
  // Synthetic pointer events need no touch support from the browser.
  test.use({ viewport: { width: 400, height: 760 } });

  test("opens a player's menu with a long press, and does not attack (R-DIPLO-01)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startGame(page);
    // On a phone the guide covers a good part of the map: put away, as a player would.
    const hide = page.locator("#guide-hide");
    if (await hide.isVisible()) await hide.click();
    const menu = page.locator("#player-menu");
    // Zoomed out, the bots' land is in view.
    const box = await page.locator("#map").boundingBox();
    if (!box) throw new Error("the map has no size");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
    // A bot's land, either bot's, found on screen by its colour in the leaderboard.
    const bots = await page.evaluate<{ name: string; color: string }[]>(
      `[...document.querySelectorAll(".leader-button")].map((button) => ({
        name: button.querySelector(".leader-name").textContent,
        color: getComputedStyle(button.querySelector(".swatch")).backgroundColor,
      }))`,
    );
    const search = async () => {
      for (const bot of bots) {
        const point = await findColor(page, bot.color);
        if (point) return { ...point, name: bot.name };
      }
      return undefined;
    };
    // A tall screen shows the map's whole height but not its width: pan east, then west.
    // Keys move the camera while held.
    let at = await search();
    for (let i = 0; i < 24 && !at; i++) {
      const key = i < 8 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await frames(page, 24);
      await page.keyboard.up(key);
      // Searched once the camera stands still, so that the press lands on what was found.
      at = await search();
    }
    if (!at) throw new Error("no bot's land on screen");
    const { name } = at;
    const { x, y } = at;
    // Synthetic pointer events carry their own time; a string, as the tests are not compiled for the DOM.
    await page.evaluate(`(async () => {
      const map = document.querySelector("#map");
      const init = { pointerId: 7, pointerType: "touch", clientX: ${String(x)}, clientY: ${String(y)}, bubbles: true };
      map.dispatchEvent(new PointerEvent("pointerdown", init));
      await new Promise((resolve) => setTimeout(resolve, 600));
      map.dispatchEvent(new PointerEvent("pointerup", init));
    })()`);
    await expect(menu.locator("h2")).toHaveText(name);
    // An attack would show up with the next updates: the clock says they came.
    // (Troops are no sign of one: they stand still once at their cap.)
    const clock = page.locator(".goal-clock");
    const before = await clock.textContent();
    await expect(clock).not.toHaveText(before ?? "", { timeout: 10_000 });
    await expect(page.locator(".attacks")).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(menu.locator(".menu-action.ask")).toBeVisible();
    // The menu stays on screen on a phone.
    const rect = await menu.boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= 400).toBe(true);
  });
});
