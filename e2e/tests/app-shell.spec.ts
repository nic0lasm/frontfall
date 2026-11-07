import { expect, test, type Page } from "@playwright/test";

// The app shell (ADR 0013): the page's state on `body[data-screen]`, and the address the page
// writes for it, through every way into a game and out of one.

const screenOf = (page: Page) => page.locator("body");

/** Seconds of play the HUD clock shows, as "m:ss of …". */
const clockOf = async (page: Page): Promise<number> => {
  const text = (await page.locator(".goal-clock").textContent()) ?? "";
  const [minutes, seconds] = text.split(" ")[0]?.split(":").map(Number) ?? [];
  return (minutes ?? 0) * 60 + (seconds ?? 0);
};

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

test("a solo game, its replay and the way back each have their state and address", async ({
  page,
}) => {
  test.skip(test.info().project.name === "firefox", "the same shell as in Chromium");
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const body = screenOf(page);

  await page.goto("./?map=island&bots=3&difficulty=normal&nations=0&speed=30&minutes=1");
  await expect(body).toHaveAttribute("data-screen", "menu");
  await page.locator("#play").click();
  await expect(body).toHaveAttribute("data-screen", "playing");
  await expect(page).toHaveURL(/[?&]map=island(&|$)/);
  const end = page.locator(".end-screen");
  await expect(end).toBeVisible({ timeout: 120_000 });
  await expect(body).toHaveAttribute("data-screen", "ended");

  const saved = page.waitForEvent("download");
  await end.getByRole("button", { name: "Save the replay" }).click();
  const path = await (await saved).path();
  await end.getByRole("button", { name: "Main menu" }).click();
  await expect(body).toHaveAttribute("data-screen", "menu");
  await expect(page).toHaveURL(/[?&]map=island(&|$)/);
  const menu = page.url();

  // A replay leaves the address as it was: its file is not in it.
  await page.locator("#replay-file").setInputFiles(path);
  await expect(page.locator("#replay-bar")).toBeVisible({ timeout: 30_000 });
  await expect(body).toHaveAttribute("data-screen", "watching");
  expect(page.url()).toBe(menu);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("#leave").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(body).toHaveAttribute("data-screen", "menu");
  expect(page.url()).toBe(menu);
  expect(pageErrors).toEqual([]);
});

test("an invitation asks the name, then the lobby and the game keep its address", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name === "firefox", "the same shell as in Chromium");
  test.setTimeout(150_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) page.on("pageerror", (error) => pageErrors.push(error));

  await host.goto(baseURL);
  await expect(screenOf(host)).toHaveAttribute("data-screen", "menu");
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await expect(screenOf(host)).toHaveAttribute("data-screen", "lobby");
  const game = new URL(await invite.inputValue()).searchParams.get("game") ?? "";
  const address = new RegExp(`[?&]game=${game}(&|$)`);
  await expect(host).toHaveURL(address);
  await host.locator("#lobby-bots").fill("2");
  await host.locator("#lobby-nations").uncheck();

  await guest.goto(await invite.inputValue());
  await expect(screenOf(guest)).toHaveAttribute("data-screen", "join");
  await guest.locator("#join-submit").click();
  await expect(screenOf(guest)).toHaveAttribute("data-screen", "lobby");
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await host.locator("#lobby-start").click();
  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: 60_000 });
    await expect(screenOf(page)).toHaveAttribute("data-screen", "playing");
    await expect(page).toHaveURL(address);
  }
  await expect.poll(() => clockOf(host), { timeout: 30_000 }).toBeGreaterThan(2);

  // A reload takes the seat back from the address, straight into the game.
  await guest.reload();
  await expect(guest.locator("#map canvas")).toBeVisible({ timeout: 60_000 });
  await expect(screenOf(guest)).toHaveAttribute("data-screen", "playing");
  await expect(guest).toHaveURL(address);

  guest.once("dialog", (dialog) => void dialog.accept());
  await guest.locator("#leave").click();
  await expect(guest.locator("#menu")).toBeVisible();
  await expect(screenOf(guest)).toHaveAttribute("data-screen", "menu");
  expect(new URL(guest.url()).searchParams.has("game")).toBe(false);
  expect(pageErrors).toEqual([]);
  await Promise.all([host.close(), guest.close()]);
});

test.describe("the globe prototype", () => {
  // The picture itself: the full map, not the flat one the other specs use.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("keeps the view in the address across G and a reload", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "one browser is enough");
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 640, height: 360 });
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const body = screenOf(page);
    const map = page.locator("#map");

    await page.goto("./?map=world&bots=4&nations=0&speed=2&view=globe");
    await page.locator("#play").click();
    await expect(body).toHaveAttribute("data-screen", "playing");
    await expect(page).toHaveURL(/[?&]view=globe(&|$)/);
    await expect(map).toHaveAttribute("data-view", "globe", { timeout: 30_000 });
    await expect.poll(() => clockOf(page), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.keyboard.press("g");
    await expect(map).toHaveAttribute("data-view", "flat");
    await expect(page).toHaveURL(/[?&]view=map(&|$)/);

    // The reload takes the game back on the flat map, and G still reaches the globe.
    await expect.poll(() => keptTick(page), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.reload();
    await expect(body).toHaveAttribute("data-screen", "playing", { timeout: 30_000 });
    await expect(map).toHaveAttribute("data-view", "flat", { timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]view=map(&|$)/);
    await page.locator(".overlay.paused").click();
    await page.keyboard.press("g");
    await expect(map).toHaveAttribute("data-view", "globe", { timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]view=globe(&|$)/);

    // Back on the menu, the view stays in the address for the next game.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#leave").click();
    await expect(body).toHaveAttribute("data-screen", "menu");
    await expect(page).toHaveURL(/[?&]view=globe(&|$)/);
    expect(pageErrors).toEqual([]);
  });
});
