import { expect, test, type Page } from "@playwright/test";

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

/** The tick of the snapshot a page keeps in IndexedDB, 0 before the first. */
const snapshotTick = (page: Page): Promise<number> =>
  page.evaluate(`new Promise((resolve) => {
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

interface Case {
  /** The special rules (R-MODE-08), collapsing fronts, capitals and doctrines, all on or all off. */
  readonly rules: boolean;
  readonly speed: 1 | 4;
}

/**
 * One case in every run; the four with E2E_MULTIPLAYER_MATRIX set, before a release.
 * Only the case with the rules on at the faster pace plays to the end and watches the replay:
 * without them the bots and nations take longer to settle a winner, and the server has no
 * shorter limit to ask for, so a wait for the end would only be a guess.
 * Both rules at four times the pace is the case where most happens in a minute.
 */
const CASES: readonly Case[] = process.env.E2E_MULTIPLAYER_MATRIX
  ? [
      { rules: true, speed: 4 },
      { rules: false, speed: 4 },
      { rules: true, speed: 1 },
      { rules: false, speed: 1 },
    ]
  : [{ rules: true, speed: 4 }];

for (const { rules, speed } of CASES) {
  const toEnd = rules && speed === 4;
  test(`three players with bots and nations, rules ${rules ? "on" : "off"}, speed ×${String(speed)}: a reload and no desync${toEnd ? ", then a replay with the same end" : ""}`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
    test.skip(test.info().project.name !== "root", "one browser is enough");
    test.setTimeout(GAME_START_TIMEOUT + 300_000);
    if (!baseURL) throw new Error("baseURL is not configured");
    const names = ["Host", "Ana", "Bea"];
    const pages = await Promise.all(names.map(() => browser.newPage()));
    const [host, reloading, other] = pages;
    if (!host || !reloading || !other) throw new Error("no pages");
    const pageErrors: Error[] = [];
    for (const page of pages) page.on("pageerror", (error) => pageErrors.push(error));

    await host.goto(baseURL);
    await host.locator("#player-name").fill("Host");
    await host.locator("#online-create").click();
    const invite = host.locator("#invite-link");
    await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
    // A small map, hard bots and nations: a winner within minutes, with fronts to break.
    await host.locator("#lobby-map").selectOption("island");
    await host.locator("#lobby-bots").fill("3");
    await host.locator("#lobby-difficulty").selectOption("hard");
    await host.locator("#lobby-nations").check();
    await host.locator("#lobby-speed").selectOption(String(speed));
    await host.locator("#lobby-collapsingFronts").setChecked(rules);
    await host.locator("#lobby-capitals").setChecked(rules);
    await host.locator("#lobby-doctrines").setChecked(rules);
    const link = await invite.inputValue();
    for (const [index, guest] of [reloading, other].entries()) {
      const invited = new URL(link);
      invited.searchParams.set("name", names[index + 1] ?? "");
      await guest.goto(invited.href);
    }
    await expect(host.locator("#lobby-players li")).toHaveCount(3, { timeout: 15_000 });

    // The guests read the host's choices, the special rules on a line of their own.
    for (const guest of [reloading, other]) {
      const summary = guest.locator("#lobby-summary");
      await expect(summary).toContainText(" 3 bots ");
      if (speed === 1) await expect(summary).not.toContainText("speed");
      else await expect(summary).toContainText(`speed ×${String(speed)}`);
      const line = guest.locator("#lobby-rules-line");
      if (rules)
        await expect(line).toHaveText("Special rules: Collapsing fronts, Capital mode, Doctrines");
      else await expect(line).toBeHidden();
    }
    await host.locator("#lobby-start").click();
    for (const page of pages) {
      await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
    }
    // Each one starts somewhere of their own.
    for (const [index, page] of pages.entries()) {
      await page.locator("#map").click({ position: { x: 300 + 200 * index, y: 250 + 60 * index } });
    }
    // The first snapshot comes after 30 seconds of play: the reload starts from it.
    await expect
      .poll(() => snapshotTick(reloading), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(300);

    // A tab reloads mid-game and takes its seat back, at the others' pace.
    await reloading.reload();
    await expect(reloading.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
    await expect
      .poll(async () => (await clockOf(host)) - (await clockOf(reloading)), { timeout: 30_000 })
      .toBeLessThan(3 * speed);
    // Two more rounds of state hashes, compared with the game it rebuilt.
    const now = await clockOf(host);
    await expect
      .poll(() => clockOf(reloading), { timeout: 30_000 })
      .toBeGreaterThan(now + 10 * speed);
    expect(await desyncs(baseURL)).toBe("0");

    expect(pageErrors).toEqual([]);
    // Elsewhere the end is too far away to wait for.
    if (!toEnd) {
      await Promise.all(pages.map((page) => page.close()));
      return;
    }

    // The game ends for everyone the same way; the host saves it and watches it again.
    const end = host.locator(".end-screen");
    await expect(end).toBeVisible({ timeout: 240_000 });
    expect(await desyncs(baseURL)).toBe("0");
    await expect(end.locator(".end-rules")).toHaveText(
      "Special rules: Collapsing fronts, Capital mode, Doctrines",
    );
    const saved = host.waitForEvent("download");
    await end.getByRole("button", { name: "Save the replay" }).click();
    const path = await (await saved).path();
    const viewer = await browser.newPage();
    viewer.on("pageerror", (error) => pageErrors.push(error));
    await viewer.goto(baseURL);
    await viewer.locator("#replay-file").setInputFiles(path);
    const bar = viewer.locator("#replay-bar");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await bar.getByRole("button", { name: "×8" }).click();
    await expect(bar.locator(".replay-result")).toHaveText("Same end as the game", {
      timeout: 180_000,
    });

    expect(pageErrors).toEqual([]);
    // The server takes eight connections per address, and every test runs from this one.
    await Promise.all([...pages, viewer].map((page) => page.close()));
  });
}
