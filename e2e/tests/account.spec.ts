import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The server's answers about the account, played by the test: the local server offers no sign-in. */
async function fakeAccount(page: Page, signedIn: unknown): Promise<string[]> {
  const asked: string[] = [];
  let me = signedIn;
  await page.route(/\/api\/me(\/\w+)?$|\/auth\/logout$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    asked.push(`${request.method()} ${path.replace(/^.*?\/(api|auth)\//, "/$1/")}`);
    if (path.endsWith("/auth/logout"))
      me = { providers: ["discord", "google"], email: true, account: null };
    if (
      path.endsWith("/api/me/merge") &&
      (request.postDataJSON() as { merge?: unknown }).merge === true
    )
      me = {
        providers: ["discord", "google"],
        email: true,
        account: { name: "Ada", provider: "discord", methods: ["discord", "google"] },
      };
    if (path.endsWith("/api/me/achievements")) {
      await route.fulfill({ json: { earned: {}, counts: {} } });
      return;
    }
    await route.fulfill({ json: me });
  });
  return asked;
}

test("a signed-in player sees how under their name, and signs out from there", async ({ page }) => {
  const asked = await fakeAccount(page, {
    providers: ["discord", "google"],
    email: true,
    account: { name: "Ada", provider: "discord", methods: ["discord"] },
  });
  await page.goto("./");
  const line = page.locator(".account-line");
  await expect(line).toContainText("Signed in with Discord.");
  await expect(page.locator("#player-name")).toHaveValue("Ada");

  await line.getByRole("button", { name: "Account" }).click();
  const box = page.locator("#menu-profile .account");
  await expect(box).toContainText("Signed in as Ada with Discord.");
  await expect(box.getByRole("button", { name: "Add Google" })).toBeVisible();
  await expect(box.getByRole("button", { name: "Add an email address" })).toBeVisible();
  await expect(box.getByRole("button", { name: "Add Discord" })).toHaveCount(0);

  await line.getByRole("button", { name: "Sign out" }).click();
  await expect(line).toBeHidden();
  await expect(page.locator("#player-name")).toHaveValue("");
  expect(asked).toContain("POST /auth/logout");
});

test("adding a service that leads to another account asks before merging", async ({ page }) => {
  const asked = await fakeAccount(page, {
    providers: ["discord", "google"],
    email: true,
    account: {
      name: "Ada",
      provider: "discord",
      methods: ["discord"],
      merge: { name: "Ada G", methods: ["google"] },
    },
  });
  await page.goto("./");
  const box = page.locator("#menu-profile .account");
  // The profile card opens by itself to ask.
  await expect(box).toContainText(
    "You already have another account, Ada G (Google). Merge it into this one?",
  );
  const audit = await new AxeBuilder({ page })
    .include("#menu-profile")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(audit.violations).toEqual([]);

  await box.getByRole("button", { name: "Merge the two accounts" }).click();
  await expect(box).toContainText("Signed in as Ada with Discord and Google.");
  await expect(box.getByRole("button", { name: "Remove Google" })).toBeVisible();
  expect(asked).toContain("POST /api/me/merge");
});
