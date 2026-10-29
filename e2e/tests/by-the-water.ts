import { expect, type Page } from "@playwright/test";

/** The player's share of the land, as the HUD shows it, in percent. */
export async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/** Points in a widening spiral around `center`, `step` pixels apart. */
export function* spiral(
  center: { x: number; y: number },
  rings: number,
  step: number,
): Generator<{ x: number; y: number }> {
  for (let ring = 0; ring < rings; ring++) {
    const radius = step * (ring + 1);
    const points = 8 + ring * 2;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      yield { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    }
  }
}

/**
 * Starts a solo game on the Strait, whose middle is the channel between its two
 * lands, and spawns on the first land a spiral from the middle finds: by the water.
 */
export async function startByTheWater(
  page: Page,
  query: string,
): Promise<{ x: number; y: number }> {
  await page.goto(`./?map=strait&bots=1&difficulty=easy&nations=0&speed=5${query}`);
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const point of spiral(center, 24, 8)) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    if ((await landShare(page)) > 0) {
      await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
      return point;
    }
  }
  throw new Error("no land near the middle of the map");
}

/**
 * Clicks around `start` with `key`'s build mode on until the cost in
 * `button` changes: the structure went up on a tile of the player's.
 * Returns the point that took it.
 *
 * Each click is answered before the next one, by a ring on the map: a
 * refusal, whose reason the note gives and which leaves the mode on, or an
 * order, which raises the cost. A click with no answer fails the test, as
 * does an order that builds nothing.
 */
export async function buildAround(
  page: Page,
  start: { x: number; y: number },
  key: string,
  button: string,
): Promise<{ x: number; y: number }> {
  const mode = page.locator(button);
  const cost = mode.locator(".build-cost");
  const first = await cost.textContent();
  const refusals: string[] = [];
  for (const point of spiral(start, 8, 4)) {
    if ((await mode.getAttribute("aria-pressed")) !== "true") await page.keyboard.press(key);
    await expect(mode).toHaveAttribute("aria-pressed", "true");
    // A ring lasts well under a second: an observer keeps the first answer this
    // click draws. The ring is there from the press, and answers once the game reads it.
    await page.evaluate(`(() => {
      window.clickAnswer = "";
      const observer = new MutationObserver((changes) => {
        for (const change of changes) {
          for (const node of [change.target, ...change.addedNodes]) {
            if (!node.classList || !node.classList.contains("click-mark")) continue;
            if (node.classList.contains("pressed")) continue;
            window.clickAnswer = node.classList.contains("refused") ? "refused" : "order";
            observer.disconnect();
            return;
          }
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    })()`);
    await page.mouse.click(point.x, point.y);
    const at = `${String(Math.round(point.x))}, ${String(Math.round(point.y))}`;
    let answer = "";
    await expect
      .poll(async () => (answer = await page.evaluate<string>("window.clickAnswer")), {
        message: `an answer to the click at ${at}`,
        timeout: 10_000,
      })
      .not.toBe("");
    if (answer === "refused") {
      refusals.push((await page.locator(".click-note").textContent()) ?? "");
      continue;
    }
    await expect(cost, "the cost after an order to build").not.toHaveText(first ?? "", {
      timeout: 5_000,
    });
    // Refused clicks before this one are expected on a coast; their reasons help when not.
    if (refusals.length > 0) console.log(`${key} built after: ${refusals.join(" / ")}`);
    return point;
  }
  throw new Error(`nothing built with ${key} around the start: ${refusals.join(" / ")}`);
}
