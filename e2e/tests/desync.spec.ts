import { readFile } from "node:fs/promises";
import {
  CITY_STATES_PER_NATION,
  loadMap,
  readDesyncReport,
  replayDesyncReport,
} from "@frontfall/engine";
import { MapManifest, encodeServerMessage, parseServerMessage } from "@frontfall/protocol";
import { expect, test } from "@playwright/test";

const MAPS = new URL("../../apps/client/public/maps/", import.meta.url);

test("a player whose game drifts apart is told, and can download a report that replays it", async ({
  browser,
  baseURL,
}) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const [host, guest, drifting] = await Promise.all([1, 2, 3].map(() => browser.newPage()));
  if (!host || !guest || !drifting) throw new Error("no pages");

  // The third player's connection loses the first order it relays: its game
  // runs one order short of everyone else's, as a real divergence would.
  let dropped = false;
  await drifting.routeWebSocket(/\/ws$/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((frame) => {
      const bytes = typeof frame === "string" ? frame : new Uint8Array(frame);
      const parsed = parseServerMessage(bytes);
      if (!dropped && parsed.ok && parsed.value.type === "turns") {
        const turns = parsed.value.turns.map((turn) => {
          if (dropped || turn.orders.length === 0) return turn;
          dropped = true;
          return { ...turn, orders: turn.orders.slice(1) };
        });
        const out = encodeServerMessage({ type: "turns", turns });
        socket.send(typeof out === "string" ? out : Buffer.from(out));
        return;
      }
      socket.send(frame);
    });
  });

  await host.goto(baseURL);
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  await host.locator("#lobby-map").selectOption("world");
  await host.locator("#lobby-bots").fill("2");
  const link = await invite.inputValue();
  for (const page of [guest, drifting]) {
    await page.goto(link);
    await page.locator("#join-submit").click();
  }
  await expect(host.locator("#lobby-players li")).toHaveCount(3, { timeout: 15_000 });
  await host.locator("#lobby-start").click();
  for (const page of [host, guest, drifting]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: 60_000 });
  }
  await host.locator("#map").click({ position: { x: 300, y: 300 } });

  // Two players against one: only the drifting player is told.
  const report = drifting.locator("#desync-report");
  await expect(report).toBeVisible({ timeout: 30_000 });
  expect(dropped).toBe(true);
  await expect(host.locator(".notice")).toHaveCount(0);
  await expect(guest.locator(".notice")).toHaveCount(0);

  const download = drifting.waitForEvent("download");
  await report.click();
  const file = await (await download).path();
  const saved = readDesyncReport(JSON.parse(await readFile(file, "utf8")));
  expect(saved.map.id).toBe("world");

  const manifest = MapManifest.parse(
    JSON.parse(await readFile(new URL("world.json", MAPS), "utf8")),
  );
  // Three players and two bots, then the map's nations and their city-states, which the replay plays too.
  const nations = manifest.nations.length;
  expect(saved.players).toHaveLength(5 + nations * (1 + CITY_STATES_PER_NATION));
  expect(saved.cityStates).toHaveLength(nations * CITY_STATES_PER_NATION);
  expect(saved.nations).toHaveLength(manifest.nations.length);
  const { terrain } = loadMap(
    new Uint8Array(await readFile(new URL(manifest.terrain.file, MAPS))),
    manifest,
  );
  const replay = replayDesyncReport(saved, terrain);
  expect(replay.firstLocalMismatch).toBeUndefined();
  expect(replay.firstDesync?.tick).toBeGreaterThanOrEqual(0);
  await Promise.all([host, guest, drifting].map((page) => page.close()));
});
