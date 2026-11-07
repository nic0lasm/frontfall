import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = 8090;
const PROXY_PORT = 8091;
/** A server of its own for the test that forces a desync, so the others can count none. */
const DESYNC_PORT = 8092;
const DESYNC_TEST = "desync.spec.ts";

/** A deployed game to test instead of the local build, such as https://nclsmgr.com/frontfall/. */
const remote = process.env.E2E_BASE_URL;

/**
 * The flat map (one colour a tile, no relief or shading) for the tests that play a game and
 * look at the rules, not at the picture: a software renderer draws it about three times faster.
 * A spec about the picture turns it off with `test.use({ storageState: undefined })`.
 */
const flatMap = {
  cookies: [],
  origins: [
    `http://127.0.0.1:${String(SERVER_PORT)}`,
    `http://127.0.0.1:${String(PROXY_PORT)}`,
    ...(remote ? [new URL(remote).origin] : []),
  ].map((origin) => ({
    origin,
    localStorage: [{ name: "frontfall.accessibility", value: JSON.stringify({ flatMap: true }) }],
  })),
};

const local = {
  projects: [
    {
      name: "root",
      testIgnore: DESYNC_TEST,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${String(SERVER_PORT)}/` },
    },
    {
      name: "prefix",
      testIgnore: DESYNC_TEST,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${String(PROXY_PORT)}/frontfall/`,
      },
    },
    {
      name: "firefox",
      testIgnore: DESYNC_TEST,
      use: {
        ...devices["Desktop Firefox"],
        baseURL: `http://127.0.0.1:${String(SERVER_PORT)}/`,
        // Headless Firefox on Linux has no WebGL: it runs headed, under xvfb in CI,
        // with WebGL forced on over software rendering.
        headless: false,
        launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } },
      },
    },
    {
      // Safari's engine, which every iPhone browser uses: the paths a new player takes.
      name: "webkit",
      testMatch: [
        "solo-game.spec.ts",
        "replay.spec.ts",
        "globe.spec.ts",
        "walking-skeleton.spec.ts",
        "phone-hud.spec.ts",
        "accessibility.spec.ts",
        "profile.spec.ts",
        "achievements.spec.ts",
        "compat.spec.ts",
      ],
      use: { ...devices["Desktop Safari"], baseURL: `http://127.0.0.1:${String(SERVER_PORT)}/` },
    },
    {
      name: "desync",
      testMatch: DESYNC_TEST,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${String(DESYNC_PORT)}/` },
    },
  ],
  webServer: [
    {
      command: "node ../apps/server/dist/server.mjs",
      env: {
        PORT: String(SERVER_PORT),
        FRONTFALL_STATIC: "../apps/client/dist",
        FRONTFALL_COUNTDOWN_SECONDS: "2",
        // Every browser of the tests shares 127.0.0.1, and their games run side by side.
        FRONTFALL_GAMES_PER_ADDRESS: "0",
      },
      url: `http://127.0.0.1:${String(SERVER_PORT)}/healthz`,
      reuseExistingServer: false,
    },
    {
      command: "node src/prefix-proxy.ts",
      env: { PROXY_PORT: String(PROXY_PORT), UPSTREAM_PORT: String(SERVER_PORT) },
      url: `http://127.0.0.1:${String(PROXY_PORT)}/frontfall/healthz`,
      reuseExistingServer: false,
    },
    {
      command: "node ../apps/server/dist/server.mjs",
      env: {
        PORT: String(DESYNC_PORT),
        FRONTFALL_STATIC: "../apps/client/dist",
        FRONTFALL_COUNTDOWN_SECONDS: "2",
        // Every browser of the tests shares 127.0.0.1, and their games run side by side.
        FRONTFALL_GAMES_PER_ADDRESS: "0",
      },
      url: `http://127.0.0.1:${String(DESYNC_PORT)}/healthz`,
      reuseExistingServer: false,
    },
  ],
};

/** Runs against the production build (`bun run build` first), or against E2E_BASE_URL. */
export default defineConfig({
  testDir: "tests",
  // Shards are cut test by test, not file by file, so that one long file cannot keep a runner busy.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure", storageState: flatMap },
  ...(remote
    ? {
        projects: [
          {
            name: "remote",
            // Local only, and it needs the whole workspace, which the smoke test does not install.
            testIgnore: DESYNC_TEST,
            use: { ...devices["Desktop Chrome"], baseURL: remote },
          },
        ],
      }
    : local),
});
