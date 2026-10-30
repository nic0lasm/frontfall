import { expect, test, type Page } from "@playwright/test";

/** Cloudflare Web Analytics, injected by the proxy in front of the public server. */
const PROXY_INJECTED = process.env.E2E_BASE_URL
  ? [
      "https://static.cloudflareinsights.com/",
      "https://cloudflareinsights.com/",
      // Its beacon, at the root of the site rather than under the game's path.
      new URL("/cdn-cgi/", process.env.E2E_BASE_URL).href,
    ]
  : [];

/** The map loads, then the server starts the game. */
const GAME_START_TIMEOUT = 60_000;

/** The local server counts desyncs; the test that forces one has a server of its own. */
async function desyncs(baseURL: string): Promise<string> {
  const metrics = await (await fetch(new URL("metrics", baseURL))).text();
  return /^frontfall_desyncs_total (\d+)$/m.exec(metrics)?.[1] ?? "missing";
}

/** Seconds of play the HUD clock shows, as "m:ss of …". */
const clockOf = async (page: Page): Promise<number> => {
  const text = (await page.locator(".goal-clock").textContent()) ?? "";
  const [minutes, seconds] = text.split(" ")[0]?.split(":").map(Number) ?? [];
  return (minutes ?? 0) * 60 + (seconds ?? 0);
};

/**
 * Pixels in the second player colour (#E69F00, give or take the relief's
 * shading) in the middle of the map, away from the HUD and its swatches.
 */
async function amberPixels(page: Page): Promise<number> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const clip = { x: size.width / 2 - 200, y: size.height / 2 - 150, width: 400, height: 300 };
  const png = (await page.screenshot({ scale: "css", clip })).toString("base64");
  // The suite has no DOM types: the counting runs in the page, as a string.
  return page.evaluate<number>(`(async (png) => {
    const image = new Image();
    image.src = "data:image/png;base64," + png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 170 && g > 105 && g < 200 && b < 60 && r - g > 40) count++;
    }
    return count;
  })("${png}")`);
}

test("two players meet in a private game without leaving the base path", async ({
  browser,
  baseURL,
  browserName,
}) => {
  test.setTimeout(GAME_START_TIMEOUT + 30_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const requested: string[] = [];
  const sockets: string[] = [];
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) {
    page.on("request", (request) => requested.push(request.url()));
    page.on("websocket", (socket) => sockets.push(socket.url()));
    page.on("pageerror", (error) => pageErrors.push(error));
  }

  // A private game: the smoke test after a deployment never sits in the public queue.
  await host.goto(baseURL);
  await host.locator("#player-name").fill("Host");
  const menuBots = await host.locator("#bot-count").inputValue();
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  const link = await invite.inputValue();
  expect(link.startsWith(baseURL)).toBe(true);

  // The game takes the menu's choices; the host changes them in the lobby.
  await expect(host.locator("#lobby-bots")).toHaveValue(menuBots);
  // Maps by group, as in the menu: the game's seats fit whichever is picked.
  await expect(host.locator('#lobby-map optgroup[label="World maps"] option')).toHaveCount(7);
  await expect(host.locator('#lobby-map optgroup[label="Quick games"] option')).toHaveCount(3);
  await host.locator("#lobby-map").selectOption("world");
  await host.locator("#lobby-bots").fill("0");
  await host.locator("#lobby-difficulty").selectOption("hard");
  await expect(host.locator("#lobby-bots")).toHaveValue("0");
  await host.locator("#lobby-allow-silo").uncheck();

  // The link asks the guest for a name first, and keeps it for next time.
  await guest.goto(link);
  await guest.locator("#join-name").fill("Guest");
  await guest.locator("#join-submit").click();
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await expect(host.locator("#lobby-players")).toContainText("Guest");
  expect(await guest.evaluate(() => localStorage.getItem("frontfall.setup"))).toContain("Guest");
  await expect(guest.locator("#lobby-start")).toBeHidden();
  await expect(guest.locator("#lobby-map")).toBeHidden();
  await expect(guest.locator("#lobby-summary")).toHaveText(
    "World · 0 bots · nations · Hard · starts when full · left out: Silo",
  );
  await host.locator("#lobby-start").click();

  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
    await expect(page.locator(".leaderboard")).toContainText("Host");
  }
  // The guest picks a start, and their map closes in on it, drawn in their
  // colour: amber, the second of the palette, as for any player after the first.
  await guest.locator("#map").click({ position: { x: 300, y: 300 } });
  // The order comes back in a turn after the pacer's delay, which on a loaded
  // runner is a few seconds at the start of a game: wait for the land, then
  // the ring of the order has let go, well before it gives up.
  await expect(guest.locator(".stats .stat-value").nth(2)).not.toHaveText("0%", {
    timeout: 15_000,
  });
  await expect(guest.locator(".click-mark.pending")).toHaveCount(0, { timeout: 1_000 });
  // WebKit draws the start in amber too, but its screenshots do not count as
  // such: the colour is checked in the other browsers.
  if (browserName !== "webkit") {
    await expect.poll(() => amberPixels(guest), { timeout: 15_000 }).toBeGreaterThan(100);
  }

  // Both clocks run on the server's turns.
  const start = await clockOf(guest);
  await expect.poll(() => clockOf(guest), { timeout: 10_000 }).toBeGreaterThan(start);
  await expect.poll(() => clockOf(host), { timeout: 10_000 }).toBeGreaterThan(start);

  // An online game runs for everyone: no pause, in the HUD or in the help.
  await expect(host.locator("#pause")).toHaveCount(0);
  // Its pace is the host's, picked in the lobby (R-MODE-07).
  await expect(host.locator("#speed")).toHaveCount(0);
  await host.keyboard.press("KeyH");
  await expect(host.locator(".help")).toContainText("never pauses");
  await expect(host.locator(".help")).not.toContainText("P: pause");
  await host.keyboard.press("Escape");
  await expect(host.locator(".help")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  const socketUrl = new URL("ws", baseURL).href.replace(/^http/, "ws");
  expect(sockets).toEqual([socketUrl, socketUrl]);
  const outside = requested.filter(
    (url) =>
      !url.startsWith(baseURL) &&
      !url.startsWith("data:") &&
      !PROXY_INJECTED.some((prefix) => url.startsWith(prefix)),
  );
  expect(outside).toEqual([]);
});

test("four players see the same game, without a desync", async ({ browser, baseURL }) => {
  // The local server only: its metrics count desyncs, and four pages are heavy.
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const names = ["Host", "Ana", "Bea", "Cyd"];
  const pages = await Promise.all(names.map(() => browser.newPage()));
  const [host, ...guests] = pages;
  if (!host) throw new Error("no host page");
  const pageErrors: Error[] = [];
  for (const page of pages) page.on("pageerror", (error) => pageErrors.push(error));

  await host.goto(baseURL);
  await host.locator("#player-name").fill("Host");
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  const link = await invite.inputValue();
  // Humans only: the game takes the menu's bots and the map's nations otherwise.
  await host.locator("#lobby-bots").fill("0");
  await host.locator("#lobby-nations").uncheck();
  for (const [index, guest] of guests.entries()) {
    const invited = new URL(link);
    invited.searchParams.set("name", names[index + 1] ?? "");
    await guest.goto(invited.href);
  }
  await expect(host.locator("#lobby-players li")).toHaveCount(4, { timeout: 15_000 });
  // The guests read the host's settings.
  const summary = (guests[0] ?? host).locator("#lobby-summary");
  await expect(summary).toContainText(" 0 bots ");
  await expect(summary).not.toContainText("nations");
  await host.locator("#lobby-start").click();

  // Every page lists the same four players with the same colours.
  const leaders = async (page: Page) => {
    // The colour as drawn: the public server's policy blocks style attributes.
    const rows = await page.evaluate<{ name: string; color: string }[]>(`
      [...document.querySelectorAll(".leaderboard-list li")].map((row) => ({
        name: row.querySelector(".leader-name").textContent,
        color: getComputedStyle(row.querySelector(".swatch")).backgroundColor,
      }))`);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  };
  for (const page of pages) {
    // The leaderboard lists the first three at rest: open it for all four.
    await page.locator("#leaderboard-toggle").click({ timeout: GAME_START_TIMEOUT });
    await expect(page.locator(".leaderboard-list li")).toHaveCount(4, {
      timeout: GAME_START_TIMEOUT,
    });
  }
  const seen = await Promise.all(pages.map(leaders));
  expect(seen[0]?.map((row) => row.name)).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(new Set(seen[0]?.map((row) => row.color)).size).toBe(4);
  expect(seen[0]?.map((row) => row.color)).not.toContain("rgba(0, 0, 0, 0)");
  for (const rows of seen) expect(rows).toEqual(seen[0]);

  // Clients hash their state every 5 seconds; let two rounds be compared.
  await expect.poll(() => clockOf(host), { timeout: 30_000 }).toBeGreaterThan(12);
  for (const page of pages) await expect.poll(() => clockOf(page)).toBeGreaterThan(11);
  expect(await desyncs(baseURL)).toBe("0");
  expect(pageErrors).toEqual([]);
  // The server takes eight connections per address, and every test runs from this one.
  await Promise.all(pages.map((page) => page.close()));
});

test("a player who reloads mid-game takes their seat back", async ({ browser, baseURL }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) page.on("pageerror", (error) => pageErrors.push(error));

  await host.goto(baseURL);
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await host.locator("#lobby-bots").fill("2");
  // Four rows on the board: the players and the bots, without nations.
  await host.locator("#lobby-nations").uncheck();
  await guest.goto(await invite.inputValue());
  await guest.locator("#join-submit").click();
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await host.locator("#lobby-start").click();
  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }
  await guest.locator("#map").click({ position: { x: 300, y: 300 } });
  const land = guest.locator(".stats .stat-value").nth(2);
  await expect(land).not.toHaveText("0%", { timeout: 10_000 });
  await expect.poll(() => clockOf(host), { timeout: 20_000 }).toBeGreaterThan(6);

  // The tab reloads: the game comes back as it was, at the others' pace.
  await guest.reload();
  await expect(guest.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  await expect(land).not.toHaveText("0%", { timeout: 30_000 });
  await guest.locator("#leaderboard-toggle").click({ timeout: GAME_START_TIMEOUT });
  await expect(guest.locator(".leaderboard-list li")).toHaveCount(4);
  await expect
    .poll(async () => (await clockOf(host)) - (await clockOf(guest)), { timeout: 20_000 })
    .toBeLessThan(3);
  // Two more rounds of state hashes, compared with the guest's replayed game.
  const now = await clockOf(host);
  await expect.poll(() => clockOf(guest), { timeout: 20_000 }).toBeGreaterThan(now + 10);
  expect(await desyncs(baseURL)).toBe("0");
  for (const page of [host, guest]) await expect(page.locator(".notice")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await Promise.all([host.close(), guest.close()]);
});

test("a player who reloads later starts from a snapshot, not from the first turn (#39)", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 120_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) page.on("pageerror", (error) => pageErrors.push(error));
  const rejoins: number[] = [];
  guest.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload) as { type?: string; from?: number };
      if (message.type === "rejoin") rejoins.push(message.from ?? -1);
    });
  });

  await host.goto(baseURL);
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await host.locator("#lobby-bots").fill("2");
  await guest.goto(await invite.inputValue());
  await guest.locator("#join-submit").click();
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await host.locator("#lobby-start").click();
  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }
  await guest.locator("#map").click({ position: { x: 300, y: 300 } });
  // The first snapshot comes after 30 seconds of play, into IndexedDB.
  const kept = (): Promise<number> =>
    guest.evaluate(`new Promise((resolve) => {
      const request = indexedDB.open("frontfall", 1);
      // Not before the page made it: a database opened here would have no store.
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => resolve(0);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("snapshots")) return resolve(0);
        const read = database.transaction("snapshots").objectStore("snapshots").get("current");
        read.onerror = () => resolve(0);
        read.onsuccess = () => resolve(read.result?.tick ?? 0);
      };
    })`);
  await expect.poll(kept, { timeout: 60_000 }).toBeGreaterThanOrEqual(300);

  await guest.reload();
  await expect(guest.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  expect(rejoins.at(-1)).toBeGreaterThanOrEqual(300);
  await expect(guest.locator(".leaderboard-list li")).not.toHaveCount(0);
  await expect
    .poll(async () => (await clockOf(host)) - (await clockOf(guest)), { timeout: 20_000 })
    .toBeLessThan(3);
  // Two more rounds of state hashes, compared with the game the guest loaded.
  const now = await clockOf(host);
  await expect.poll(() => clockOf(guest), { timeout: 20_000 }).toBeGreaterThan(now + 10);
  expect(await desyncs(baseURL)).toBe("0");
  for (const page of [host, guest]) await expect(page.locator(".notice")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await Promise.all([host.close(), guest.close()]);
});

test("a player whose connection drops is told, and plays on once it is back", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const page = await browser.newPage();
  // The first connection plays until it is cut, the second fails, the third holds.
  let attempts = 0;
  let first: { close(): Promise<void> } | undefined;
  await page.routeWebSocket(/\/ws$/, (socket) => {
    attempts++;
    if (attempts === 2) {
      void socket.close();
      return;
    }
    socket.connectToServer();
    if (attempts === 1) first = socket;
  });

  await page.goto(baseURL);
  await page.locator("#online-create").click();
  await expect(page.locator("#invite-link")).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await page.locator("#lobby-start").click();
  await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  await expect.poll(() => clockOf(page), { timeout: 20_000 }).toBeGreaterThan(2);

  await first?.close();
  const notice = page.locator("#connection-status");
  await expect(notice).toContainText("Disconnected, retrying in");
  await expect(notice).toHaveCount(0, { timeout: 20_000 });
  const back = await clockOf(page);
  await expect.poll(() => clockOf(page), { timeout: 20_000 }).toBeGreaterThan(back + 2);
  await expect(page.locator(".notice")).toHaveCount(0);
  await page.close();
});

test("two players join a public game from the menu", async ({ browser, baseURL }) => {
  // Never against the public server: real players could join the test's game.
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.setTimeout(GAME_START_TIMEOUT + 30_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const pages = [await browser.newPage(), await browser.newPage()];
  for (const page of pages) {
    await page.goto(baseURL);
    await page.locator("#online-play").click();
    // Alone, the first one sees bots coming; the second, the game about to start.
    await expect(page.locator("#lobby-status")).toHaveText(/^(Alone for now|Starting in)/);
  }
  for (const page of pages) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }
});

test("a host names a public game, others find it in the list, the host starts it", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const [host, guest, late] = [
    await browser.newPage(),
    await browser.newPage(),
    await browser.newPage(),
  ];
  const name = `Europe ${String(Date.now() % 100_000)}`;

  await host.goto(baseURL);
  await host.locator("#player-name").fill("Host");
  // Open by itself when there are games, so set it rather than toggle it.
  await host.evaluate(`document.querySelector("#online-more").open = true`);
  await host.locator("#online-game-name").fill(name);
  await host.locator("#online-create-public").click();
  await expect(host.locator("#lobby-title")).toHaveText(name, { timeout: 15_000 });
  await expect(host.locator("#lobby-start")).toBeDisabled();
  await expect(host.locator("#lobby-hold")).toBeHidden();
  await host.locator("#lobby-seats").selectOption("4");
  await host.locator("#lobby-auto").uncheck();

  // The game shows in the list of the others, with its host and seats.
  await guest.goto(baseURL);
  await guest.locator("#player-name").fill("Guest");
  const row = guest.locator(".public-game", { hasText: name });
  await expect(row).toContainText("host: Host", { timeout: 10_000 });
  await expect(row).toContainText("1/4");
  await row.getByRole("button", { name: "Join" }).click();
  await expect(guest.locator("#lobby-status")).toHaveText(/Host starts the game/, {
    timeout: 15_000,
  });
  await expect(guest.locator("#lobby-start")).toBeHidden();

  // Nothing starts on its own: the host decides.
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await host.waitForTimeout(3_000);
  await expect(host.locator("#lobby")).toBeVisible();
  await expect(host.locator("#lobby-start")).toBeEnabled();
  await host.locator("#lobby-start").click();
  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }

  // A third player sees it running, and cannot join it.
  await late.goto(baseURL);
  const running = late.locator(".public-game", { hasText: name });
  await expect(running).toContainText("In progress", { timeout: 10_000 });
  await expect(running.getByRole("button", { name: "Join" })).toBeDisabled();
  await Promise.all([host.close(), guest.close(), late.close()]);
});

test("says when an invitation leads nowhere", async ({ page }) => {
  await page.goto("./?game=AAAAAAAAAAAA");
  await page.locator("#join-submit").click();
  await expect(page.locator("#lobby-status")).toContainText("No game has this invitation link");
  await page.locator("#lobby-leave").click();
  await expect(page.locator("#menu")).toBeVisible();
});

test("lists public games as JSON", async ({ request, baseURL }) => {
  const response = await request.get(new URL("api/games", baseURL).href);
  expect(response.ok()).toBe(true);
  // The server sends no-store; the production proxy rewrites it to no-cache, which is as good.
  expect(response.headers()["cache-control"]).toMatch(/^no-(store|cache)$/);
  expect(await response.json()).toHaveProperty("games");
});

test("keeps the metrics private behind the proxy", async ({ request, baseURL }) => {
  test.skip(!baseURL?.endsWith("/frontfall/"), "only a proxied server hides its metrics");
  const response = await request.get(new URL("metrics", baseURL).href);
  expect(response.status()).toBe(404);
});

test("a player who closed the tab is offered the game back from the menu", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  // One browser for the guest: the tab they open again shares the closed one's storage.
  const guestBrowser = await browser.newContext();
  const guest = await guestBrowser.newPage();

  await host.goto(baseURL);
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await host.locator("#lobby-bots").fill("2");
  await guest.goto(await invite.inputValue());
  await guest.locator("#join-submit").click();
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await host.locator("#lobby-start").click();
  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }
  await expect.poll(() => clockOf(host), { timeout: 20_000 }).toBeGreaterThan(4);
  await guest.close();

  // Opened again a while later, as the menu: older than a tab still playing it.
  await guestBrowser.addInitScript(() => {
    const seat = JSON.parse(localStorage.getItem("frontfall.seat") ?? "null") as {
      seenAt: number;
    } | null;
    if (seat) {
      seat.seenAt -= 20_000;
      localStorage.setItem("frontfall.seat", JSON.stringify(seat));
    }
  });
  const back = await guestBrowser.newPage();
  await back.goto(baseURL);
  await expect(back.locator("#menu")).toBeVisible();
  await back.locator("#resume").getByRole("button", { name: "Resume" }).click();
  await expect(back.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  await expect
    .poll(async () => (await clockOf(host)) - (await clockOf(back)), { timeout: 20_000 })
    .toBeLessThan(3);
  expect(await desyncs(baseURL)).toBe("0");
  await Promise.all([host.close(), guestBrowser.close()]);
});
