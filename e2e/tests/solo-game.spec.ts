import { expect, test, type Page } from "@playwright/test";

/** The player's share of the land, as the HUD shows it, in percent. */
async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/** Clicks in a widening spiral around a point until `done` holds; returns the last point clicked. */
async function clickAround(
  page: Page,
  center: { x: number; y: number },
  done: () => Promise<boolean>,
): Promise<{ x: number; y: number }> {
  let last = center;
  for (let ring = 0; ring < 12; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * 2 * Math.PI;
      const radius = 20 + ring * 25;
      last = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      await page.mouse.click(last.x, last.y);
      await page.waitForTimeout(150);
      if (await done()) return last;
    }
  }
  return last;
}

test("plays a solo game from the menu: spawn, then expand", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator('input[name="map"][value="skirmish"]')).toBeChecked();
  await expect(page.locator("#bot-count")).toHaveValue("2");
  await page.locator("#player-name").fill("Tester");
  await page.locator("#play").click();

  await expect(page.locator("#menu")).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".banner")).toContainText("choose where you start");

  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Spawn on the first land tile the spiral finds.
  await clickAround(page, center, async () => (await landShare(page)) > 0);
  expect(await landShare(page)).toBeGreaterThan(0);
  await expect(page.locator(".leaderboard")).toContainText("Tester");
  // Player colours show even where the server forbids inline styles, as in production.
  await expect(page.locator(".leaderboard-list .swatch").first()).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  // Attacks open when the spawn phase ends.
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  const before = await landShare(page);
  await page.keyboard.press("Shift+Digit5");
  await expect(page.locator("#attack-ratio")).toHaveValue("50");
  await clickAround(page, center, async () => (await landShare(page)) > before);
  await expect.poll(() => landShare(page), { timeout: 10_000 }).toBeGreaterThan(before);

  // With all its troops, an attack lasts long enough to be called back.
  await page.keyboard.press("Shift+Digit0");
  await expect(page.locator("#attack-ratio")).toHaveValue("100");
  const retreat = page.locator(".attack-retreat");
  await clickAround(page, center, async () => (await retreat.count()) > 0);
  while ((await retreat.count()) > 0) {
    await retreat
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
  }
  // The pointer rests on the map, where it may show the preview of an attack in the same panel.
  await page.locator(".stats").hover();
  await expect(page.locator(".attacks")).toBeHidden();

  expect(pageErrors).toEqual([]);
});

/** A picture of the page around a point, to compare with a later one. */
async function look(page: Page, at: { x: number; y: number }): Promise<string> {
  const clip = { x: at.x - 40, y: at.y - 40, width: 80, height: 80 };
  return (await page.screenshot({ scale: "css", clip })).toString("base64");
}

/** Pixels around a point that differ clearly from an earlier `look`: what a structure adds. */
async function changedSince(
  page: Page,
  at: { x: number; y: number },
  before: string,
): Promise<number> {
  const now = await look(page, at);
  // The suite has no DOM types: the counting runs in the page, as a string.
  return page.evaluate<number>(`(async (a, b) => {
    const read = async (png) => {
      const image = new Image();
      image.src = "data:image/png;base64," + png;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [x, y] = [await read(a), await read(b)];
    let count = 0;
    for (let i = 0; i < x.length; i += 4) {
      const gap = Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
      if (gap > 120) count++;
    }
    return count;
  })(${JSON.stringify(before)}, ${JSON.stringify(now)})`);
}

test("builds a city once the gold allows it (R-BUILD-01)", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // A hundred times the usual gold, so the first city is paid for in seconds of play.
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&speed=5&gold=500");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The tile clicked to start on stays the player's: the city goes there.
  const start = await clickAround(page, center, async () => (await landShare(page)) > 0);
  expect(await landShare(page)).toBeGreaterThan(0);

  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  const city = page.locator("#build-city");
  // One generous deadline: how fast the gold comes depends on the machine's speed.
  await expect(city).not.toHaveClass(/unaffordable/, { timeout: 60_000 });

  const before = await look(page, start);
  await page.keyboard.press("KeyC");
  await expect(city).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".banner")).toContainText("build a city");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#build-city .build-count")).toContainText("1 of", { timeout: 5_000 });
  await expect(city).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => changedSince(page, start, before), { timeout: 30_000 })
    .toBeGreaterThan(150);
  expect(pageErrors).toEqual([]);
});

test("builds a Micho Palace, worth two cities (R-BUILD-08)", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // Gold fast, and so little land per city that the starting land holds two.
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&speed=5&gold=1000&cityland=10");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const start = await clickAround(page, center, async () => (await landShare(page)) > 0);
  expect(await landShare(page)).toBeGreaterThan(0);

  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  const palace = page.locator("#build-palace");
  await expect(palace).not.toHaveClass(/unaffordable/, { timeout: 60_000 });

  const before = await look(page, start);
  await page.keyboard.press("KeyB");
  await expect(palace).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".banner")).toContainText("build a Micho Palace");
  await page.mouse.click(start.x, start.y);
  // It counts as two of the cities the land supports.
  await expect(page.locator("#build-city .build-count")).toContainText("2 of", { timeout: 5_000 });
  await expect(palace).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => changedSince(page, start, before), { timeout: 30_000 })
    .toBeGreaterThan(150);
  expect(pageErrors).toEqual([]);
});

test("plays against the nations of the map, named and on the board (R-BOT-07)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("./?map=island&bots=1&difficulty=easy&nations=1");
  await expect(page.locator("#nations")).toBeChecked();
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  // Placed on their tiles when the spawn phase ends, then ranked with everyone.
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  const leaders = page.locator(".leaderboard-list .leader-name");
  await expect(leaders.filter({ hasText: "Northmark" })).toHaveCount(1);
  // The leaderboard lists three leaders at rest, and all of them once opened.
  await page.locator("#leaderboard-toggle").click();
  await expect(page.locator(".leaderboard-list .leader")).toHaveCount(8);

  // Unticked, the next game has none, and the choice is remembered.
  await page.goto("./");
  // The page opened again offers the game left behind: a new one is wanted.
  await page.locator("#resume").getByRole("button", { name: "Drop it" }).click();
  await expect(page.locator("#nations")).toBeChecked();
  await page.locator("#menu-options > summary").click();
  await page.locator("#nations").uncheck();
  await page.locator("#play").click();
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  await expect(
    page.locator(".leaderboard-list .leader-name").filter({ hasText: "Northmark" }),
  ).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test("pauses and shows the controls", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=1");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await page.keyboard.press("KeyH");
  await expect(page.getByRole("dialog")).toContainText("How to play");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("runs at ×1, ×2 or ×4 from its button or T (R-MODE-07)", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=1");
  await page.locator("#play").click();
  const speed = page.locator("#speed");
  await expect(speed).toHaveText(/×1/);
  // Help, pause, speed, menu.
  await expect(page.locator("#pause + #speed")).toHaveCount(1);
  await speed.click();
  await expect(speed).toHaveText(/×2/);
  await page.locator("#map").focus();
  await page.keyboard.press("KeyT");
  await expect(speed).toHaveText(/×4/);
  await expect(speed).toHaveAttribute("aria-label", "Game speed: ×4");
  await page.keyboard.press("KeyT");
  await expect(speed).toHaveText(/×1/);
  // The pause banner offers the paces too, and keeps the game paused.
  await page.keyboard.press("KeyP");
  await page.locator(".pause-speeds [data-speed='4']").click();
  await expect(page.locator(".paused")).toBeVisible();
  await expect(speed).toHaveText(/×4/);
});

test("goes back to the menu from a game, never going online", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("./?map=skirmish&bots=1");
  await expect(page.locator("#status")).toBeHidden();
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  // No start picked yet: nothing to lose, so no confirmation.
  await page.locator("#leave").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#map")).toHaveCount(0);
  expect(sockets).toEqual([]);
});

test("offers the World first and starts a game on it", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./");
  await expect(page.locator('input[name="map"]').first()).toHaveValue("world");
  await page.locator("#menu-options > summary").click();
  await page.locator('input[name="map"][value="world"]').check({ force: true });
  await page.locator("#play").click();
  await expect(page.locator(".banner")).toContainText("choose where you start", {
    timeout: 30_000,
  });
  await expect(page.locator("#map canvas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("plays a World game against 8 bots to its end screen", async ({ page }, testInfo) => {
  // The page under a prefix adds nothing here, and the game takes a while.
  test.skip(testInfo.project.name === "prefix", "played once, at the root");
  test.setTimeout(240_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  // Thirty ticks per beat and a 3-minute limit: the 1,800 ticks of a whole
  // game run in well under a minute, every one of them simulated and drawn.
  await page.goto("./?map=world&bots=8&difficulty=hard&nations=0&speed=30&minutes=3");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".goal-clock")).toContainText("of 3:00", { timeout: 30_000 });

  const end = page.locator(".end-screen");
  await expect(end).toBeVisible({ timeout: 200_000 });
  await expect(end.locator(".end-winner")).toContainText("wins the game");
  // The player, placed by the game and never moving, cannot be the winner.
  await expect(end).toContainText("Defeat");
  await end.getByRole("button", { name: "Keep watching" }).click();
  await expect(end).toHaveCount(0);
  await expect(page.locator(".leaderboard")).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("Play again starts the same game anew from the end screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "prefix", "played once, at the root");
  test.setTimeout(240_000);
  await page.goto("./?map=world&bots=8&difficulty=hard&nations=0&speed=30&minutes=3");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();

  const end = page.locator(".end-screen");
  await expect(end).toBeVisible({ timeout: 200_000 });
  await end.getByRole("button", { name: "Play again" }).click();
  await expect(end).toHaveCount(0);
  // The same map and settings: a game of 3 minutes again, from its start.
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".goal-clock")).toContainText("of 3:00", { timeout: 30_000 });
  await expect(page).toHaveURL(/map=world/);
  await expect(page).toHaveURL(/bots=8/);
});

test("a right click leaves a build mode like Esc, and opens the menu otherwise", async ({
  page,
}) => {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  const map = page.locator("#map");
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  if (!box) throw new Error("the map has no box");
  const at = { x: box.width / 2, y: box.height / 2 };

  await page.keyboard.press("1");
  await expect(map).toHaveAttribute("data-mode", /^(?!attack$).+/);
  await map.click({ button: "right", position: at });
  await expect(map).toHaveAttribute("data-mode", "attack");
  await expect(page.locator(".player-menu:not([hidden])")).toHaveCount(0);
});

test("the attack slider shows the troops it sends beside its share", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  const map = page.locator("#map");
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const value = page.locator("#attack-ratio ~ .range-value");
  await expect(value).toHaveText(/^30\s?% · \d/);
  await page.locator("#attack-ratio").fill("60");
  await expect(value).toHaveText(/^60\s?% · \d/);
});

/** Tick of the solo game this browser keeps for a reload, or null when it keeps none. */
function keptTick(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve) => {
        const request = indexedDB.open("frontfall", 1);
        request.onerror = () => {
          resolve(null);
        };
        request.onupgradeneeded = () => {
          request.result.createObjectStore("snapshots");
        };
        request.onsuccess = () => {
          const get = request.result.transaction("snapshots").objectStore("snapshots").get("solo");
          get.onsuccess = () => {
            const kept = get.result as { tick?: number } | undefined;
            resolve(kept?.tick ?? null);
            request.result.close();
          };
          get.onerror = () => {
            resolve(null);
          };
        };
      }),
  );
}

test("a reload takes a solo game back where it was, and leaving forgets it", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&speed=10");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await expect.poll(() => keptTick(page), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("#menu")).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
  // Taken back paused, for the player to find their bearings, from the snapshot and not the start.
  const paused = page.locator(".overlay.paused");
  await expect(paused).toBeVisible();
  await paused.click();
  await expect(paused).toHaveCount(0);
  await expect(page.locator(".goal-clock")).toHaveText(/^\d+:\d\d /);
  await expect(page.locator(".goal-clock")).not.toHaveText(/^0:0\d /);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("#leave").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect.poll(() => keptTick(page)).toBeNull();
  await page.goto("./");
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#resume")).toHaveCount(0);
});

test("a tutorial reloaded a few seconds in comes back to the game", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await page.locator("#tutorial").click();
  await expect(page.locator("#map")).toBeVisible();
  // Kept within seconds of the start, not only once the spawn phase is over.
  await expect.poll(() => keptTick(page), { timeout: 9000 }).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("#menu")).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".overlay.paused")).toBeVisible();
});

test("the music slider shows its default of 35", async ({ page }) => {
  await page.goto("./");
  await page.locator("#open-accessibility").click();
  await expect(page.locator("#music-volume")).toHaveValue("35");
});
