import { expect, test } from "@playwright/test";

/** Delay of every message from the server, as over a slow connection. */
const LATENCY_MS = 600;

test("keeps the host's choices when the lobby answers late", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const page = await browser.newPage();
  await page.routeWebSocket(/\/ws$/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      setTimeout(() => {
        socket.send(message);
      }, LATENCY_MS);
    });
  });
  await page.goto(baseURL);
  await page.locator("#player-name").fill("Host");
  await page.locator("#online-create").click();
  await expect(page.locator("#invite-link")).toHaveValue(/[?&]game=/, { timeout: 15_000 });

  await page.locator("#lobby-map").selectOption("world");
  await page.waitForTimeout(2 * LATENCY_MS);
  // Faster than the lobby comes back: the answer to the first change arrives
  // between the second and the third, and must not undo the second.
  await page.locator("#lobby-bots").fill("0");
  await page.waitForTimeout(LATENCY_MS / 2);
  await page.locator("#lobby-difficulty").selectOption("hard");
  await page.waitForTimeout(LATENCY_MS * 0.7);
  await page.locator("#lobby-allow-silo").uncheck();
  await page.waitForTimeout(LATENCY_MS * 0.7);
  // A private game may run faster (R-MODE-07).
  await page.locator("#lobby-speed").selectOption("2");

  await page.waitForTimeout(4 * LATENCY_MS);
  await expect(page.locator("#lobby-speed")).toHaveValue("2");
  await expect(page.locator("#lobby-difficulty")).toHaveValue("hard");
  await expect(page.locator("#lobby-bots")).toHaveValue("0");
  await expect(page.locator("#lobby-allow-silo")).not.toBeChecked();
  // What the server holds, as every guest sees it.
  const link = new URL(await page.locator("#invite-link").inputValue());
  link.searchParams.set("name", "Guest");
  const guest = await browser.newPage();
  await guest.goto(link.href);
  await expect(guest.locator("#lobby-summary")).toHaveText(
    "World · 0 bots · nations · Hard · starts when full · speed ×2 · left out: Silo",
    { timeout: 15_000 },
  );
  // The special rules (R-MODE-08) are a line of their own for the guest, and a switch for the host.
  await expect(guest.locator("#lobby-rules-line")).toHaveText("Special rules: Collapsing fronts");
  await expect(page.locator("#lobby-collapsingFronts")).toBeChecked();
});
