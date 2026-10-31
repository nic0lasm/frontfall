import { expect, test, type Page } from "@playwright/test";

/** The map loads, then the server starts the game. */
const GAME_START_TIMEOUT = 60_000;

/** Two players in a game of their own: the second has the first's name on the leaderboard. */
async function twoPlayers(page: Page, guest: Page, baseURL: string, speed = 1): Promise<void> {
  await page.goto(baseURL);
  await page.locator("#player-name").fill("Host");
  await page.locator("#online-create").click();
  const invite = page.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await page.locator("#lobby-map").selectOption("island");
  await page.locator("#lobby-bots").fill("0");
  await page.locator("#lobby-nations").setChecked(false);
  await page.locator("#lobby-speed").selectOption(String(speed));
  const invited = new URL(await invite.inputValue());
  invited.searchParams.set("name", "Ana");
  await guest.goto(invited.href);
  await expect(page.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await page.locator("#lobby-start").click();
  for (const p of [page, guest]) {
    await expect(p.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }
  await page.locator("#map").click({ position: { x: 300, y: 250 } });
  await guest.locator("#map").click({ position: { x: 500, y: 310 } });
  for (const p of [page, guest]) {
    await expect(p.locator(".banner")).toContainText("to expand", { timeout: GAME_START_TIMEOUT });
  }
}

test("the buttons of an alliance request stay put while its countdown runs, and answer a click", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) page.on("pageerror", (error) => pageErrors.push(error));
  await twoPlayers(host, guest, baseURL);

  // Ana asks the host for an alliance from the leaderboard.
  await guest.locator('.leader-button[aria-description$="Host"]').click();
  await guest.locator("#player-menu .menu-action.ask").click();

  const request = host.locator(".requests .request");
  await expect(request).toHaveCount(1, { timeout: 20_000 });
  const accept = request.locator(".request-accept");
  const ignore = request.locator(".request-ignore");
  const handles = [await accept.elementHandle(), await ignore.elementHandle()];
  const text = await request.locator(".request-text").textContent();
  // The countdown moves on, in the text, not in new buttons: a click that starts on one
  // would otherwise end on its replacement and go nowhere.
  await expect(request.locator(".request-text")).not.toHaveText(text ?? "", { timeout: 5000 });
  for (const handle of handles) {
    expect(await handle.evaluate((node) => node.isConnected)).toBe(true);
  }

  // A press that lasts longer than a second still reaches the button it started on.
  const box = await accept.boundingBox();
  if (!box) throw new Error("the accept button has no box");
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.waitForTimeout(1500);
  await host.mouse.up();
  await expect(host.locator(".leader .badge-ally:visible")).toBeVisible({ timeout: 10_000 });
  await expect(host.locator(".requests")).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test("plays the whole diplomacy from the player's side: ignore, accept, embargo, tribute, alliance", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 300_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const ana = await browser.newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, ana]) page.on("pageerror", (error) => pageErrors.push(error));
  await twoPlayers(host, ana, baseURL, 4);
  const hostMenu = host.locator("#player-menu");
  const anaMenu = ana.locator("#player-menu");
  const onAna = host.locator('.leader-button[aria-description$="Ana"]');
  const onHost = ana.locator('.leader-button[aria-description$="Host"]');

  // 1. A request that is ignored leaves the stack; the answer stays one click away in the menu.
  await onHost.click();
  await anaMenu.locator(".menu-action.ask").click();
  await expect(anaMenu.locator(".menu-action.ask")).toBeDisabled();
  await expect(host.locator(".requests .request")).toHaveCount(1, { timeout: 20_000 });
  await host.locator(".requests .request-ignore").click();
  await expect(host.locator(".requests")).toBeHidden();
  await onAna.click();
  await expect(hostMenu.locator(".menu-action.ask")).toHaveText("Accept");
  await expect(hostMenu.locator(".menu-action.ask")).toBeEnabled();
  await host.keyboard.press("Escape");

  // 2. An embargo is put on, then lifted.
  await onAna.click();
  const embargo = hostMenu.locator(".menu-action.embargo");
  await embargo.click();
  await expect(embargo).toHaveText("Lift the embargo");
  await expect(host.locator(".events-feed")).toContainText("put an embargo");
  await embargo.click();
  await expect(embargo).toHaveText("Embargo their trade");
  await expect(host.locator(".events-feed")).toContainText("lifted the embargo");
  await host.keyboard.press("Escape");

  // 3. The host grows past a quarter more land than Ana, who then buys a truce.
  await anaMenu.waitFor({ state: "visible" });
  const tribute = anaMenu.locator(".menu-action.tribute");
  const box = await host.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  for (let i = 0; i < 400 && !(await tribute.isEnabled()); i++) {
    const angle = i * 0.7;
    const radius = 14 + (i % 14) * 7;
    await host.mouse.click(
      box.x + 300 + Math.cos(angle) * radius,
      box.y + 250 + Math.sin(angle) * radius,
    );
    await host.waitForTimeout(150);
  }
  await expect(tribute).toBeEnabled({ timeout: 120_000 });
  await tribute.click();
  await expect(ana.locator(".events-feed")).toContainText("paid tribute");
  await expect(ana.locator(".leader .badge-ally:visible")).toContainText("Truce");

  // 4. When the truce runs out, a new request is accepted from the stack: allies.
  await expect(ana.locator(".leader .badge-ally:visible")).toHaveCount(0, { timeout: 90_000 });
  await expect(anaMenu.locator(".menu-action.ask")).toBeEnabled({ timeout: 90_000 });
  await anaMenu.locator(".menu-action.ask").click();
  await expect(host.locator(".requests .request")).toHaveCount(1, { timeout: 20_000 });
  await host.locator(".requests .request-accept").click();
  await expect(host.locator(".leader .badge-ally:visible")).toContainText("Ally");
  await expect(ana.locator(".leader .badge-ally:visible")).toContainText("Ally");
  await expect(host.locator(".events-feed")).toContainText("are now allies");
  expect(pageErrors).toEqual([]);
});

test("renews an alliance in its last minute, when both ask", async ({ browser, baseURL }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 240_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const ana = await browser.newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, ana]) page.on("pageerror", (error) => pageErrors.push(error));
  await twoPlayers(host, ana, baseURL, 4);
  const hostMenu = host.locator("#player-menu");
  const anaMenu = ana.locator("#player-menu");

  // A plain click on Accept is enough.
  await ana.locator('.leader-button[aria-description$="Host"]').click();
  await anaMenu.locator(".menu-action.ask").click();
  await expect(host.locator(".requests .request")).toHaveCount(1, { timeout: 20_000 });
  await host.locator(".requests .request-accept").click();
  await expect(host.locator(".leader .badge-ally:visible")).toContainText("Ally");

  // The last minute of the five: the menus offer to renew.
  await host.locator('.leader-button[aria-description$="Ana"]').click();
  const renew = hostMenu.locator(".menu-action.renew");
  await expect(renew).toBeEnabled({ timeout: 120_000 });
  const secondsLeft = async () =>
    Number(
      /(\d+) s left/.exec((await hostMenu.locator(".player-menu-status").textContent()) ?? "")?.[1],
    );
  const before = await secondsLeft();
  await renew.click();
  await expect(renew).toHaveText("Renewal asked");
  await expect(renew).toBeDisabled();

  // Ana, asked to renew, agrees: the alliance runs again from the full five minutes.
  if (!(await anaMenu.isVisible())) {
    await ana.locator('.leader-button[aria-description$="Host"]').click();
  }
  const anaRenew = anaMenu.locator(".menu-action.renew");
  await expect(anaRenew).toBeEnabled({ timeout: 20_000 });
  await anaRenew.click();
  await expect.poll(secondsLeft, { timeout: 20_000 }).toBeGreaterThan(before);
  await expect(renew).toBeHidden();
  expect(pageErrors).toEqual([]);
});
