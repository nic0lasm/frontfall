/// <reference types="node" />
import { readFile } from "node:fs/promises";
import {
  Terrain,
  TileKind,
  WorldGrid,
  readDesyncReport,
  replayDesyncReport,
} from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import {
  GENERATED_MAPS,
  fetchManifest,
  fetchMapData,
  fetchMaps,
  warmMap,
  type MapInfo,
} from "../src/game/maps.ts";
import { SoloGame } from "../src/game/solo-game.ts";
import { CITY_STATES_PER_NATION } from "../src/game/simulation.ts";
import { botLimit, onlineMaps } from "../src/ui/lobby.ts";

const PAGE = "https://example.test/frontfall/";
const PUBLIC = new URL("../public/", import.meta.url);

/** Serves apps/client/public as if it were deployed under PAGE. */
const fromDisk = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(PAGE)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(new URL(url.slice(PAGE.length), PUBLIC));
    return new Response(bytes);
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

describe("published maps", () => {
  it("lists the World first, then the other published maps, then the generated ones", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    expect(maps[0]).toMatchObject({
      id: "world",
      wrapsX: true,
      manifest: `${PAGE}maps/world.json`,
      thumbnail: `${PAGE}maps/world.png`,
    });
    expect(maps.map((map) => map.id)).toContain("europe");
    expect(maps.slice(-GENERATED_MAPS.length)).toEqual(GENERATED_MAPS);
    expect(maps.every((map) => map.suggestedBots >= 1 && map.suggestedBots <= 24)).toBe(true);
  });

  it("sorts Earth maps from quick ones, generated maps among the quick", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    const group = (id: string) => maps.find((map) => map.id === id)?.group;
    expect(group("world")).toBe("world");
    expect(group("europe")).toBe("world");
    expect(group("island")).toBe("quick");
    expect(GENERATED_MAPS.every((map) => map.group === "quick")).toBe(true);
  });

  it("offers the published maps online, with as many bots as the server takes", async () => {
    const maps = onlineMaps(await fetchMaps(PAGE, fromDisk));
    const ids = maps.map((map) => map.id);
    // The preferred map first, then the catalogue in its own order.
    expect(ids[0]).toBe("world");
    expect(ids).toEqual(expect.arrayContaining(["europe", "africa", "americas", "asia"]));
    const world = maps[0] as MapInfo;
    const europe = maps.find((map) => map.id === "europe") as MapInfo;
    // 25 bot names; Europe takes 32 players, here 16 humans.
    expect(botLimit(world, 16)).toBe(25);
    expect(botLimit(europe, 16)).toBe(16);
    expect(botLimit(europe, 40)).toBe(0);
  });

  it("falls back to the generated maps when the catalogue is missing", async () => {
    const missing = (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;
    expect(await fetchMaps(PAGE, missing)).toEqual(GENERATED_MAPS);
  });

  it("downloads and checks the terrain of a published map", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    const europe = maps.find((map) => map.id === "europe");
    if (!europe) throw new Error("no Europe map");
    const data = await fetchMapData(europe, await fetchManifest(europe, fromDisk), fromDisk);
    expect(data.kinds).toHaveLength(europe.width * europe.height);
    expect(data.kinds.some((kind) => kind === TileKind.Water)).toBe(true);
    expect(data.kinds.some((kind) => kind === TileKind.Plains)).toBe(true);
  });
});

describe("desync report", () => {
  // Plays 260 ticks of Europe with its nations, then replays them: slow on a shared CI runner.
  it("replays an online game to the hashes this client saw", { timeout: 60_000 }, async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    const info = maps.find((map) => map.id === "europe") as MapInfo;
    const map = await fetchMapData(info, await fetchManifest(info, fromDisk), fromDisk);
    const game = new SoloGame(
      {
        map: "europe",
        seed: 9,
        bots: 3,
        difficulty: "hard",
        nations: true,
        playerName: "",
        players: [
          { id: 1, name: "Ann" },
          { id: 2, name: "Bob" },
        ],
        you: 2,
      },
      map,
    );
    const land = map.kinds.findIndex((kind) => kind === TileKind.Plains);
    for (let tick = 0; tick < 260; tick++) {
      const orders =
        tick === 3 ? [{ player: 2, order: { type: "spawn" as const, tile: land } }] : [];
      game.playTurns([{ tick, orders }]);
    }
    game.desync(250, 12345);

    const report = readDesyncReport(JSON.parse(JSON.stringify(game.report())));
    expect(report.map).toMatchObject({ id: "europe", format: 1 });
    const nations = map.nations.map((_, i) => 6 + i);
    expect(nations.length).toBeGreaterThan(0);
    const cities = Array.from(
      { length: nations.length * CITY_STATES_PER_NATION },
      (_, i) => 6 + nations.length + i,
    );
    expect(report.players.map((player) => player.id)).toEqual([
      1,
      2,
      3,
      4,
      5,
      ...nations,
      ...cities,
    ]);
    expect(report.players[5]?.start).toBe(map.nations[0]?.tile);
    expect(report.bots).toEqual({ ids: [3, 4, 5], difficulty: "hard" });
    expect(report.nations).toEqual(nations);
    expect(report.cityStates).toEqual(cities);
    expect(report.turns.map((turn) => turn.tick)).toEqual([3]);
    expect(report.hashes.map((entry) => entry.tick)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(report.hashes[1]?.expected).toBe(report.hashes[1]?.local);
    expect(report.hashes[5]?.expected).toBe(12345);

    const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
    const result = replayDesyncReport(report, new Terrain(grid, map.kinds));
    expect(result.ticks).toBe(260);
    expect(result.firstLocalMismatch).toBeUndefined();
    expect(result.firstDesync?.tick).toBe(250);
  });

  it("has nothing to report on a generated map, or solo", async () => {
    const solo = new SoloGame(
      { map: "continents", seed: 1, bots: 1, difficulty: "easy", playerName: "Me" },
      await fetchMapData(GENERATED_MAPS[0] as MapInfo, undefined),
    );
    expect(solo.report()).toBeUndefined();
  });
});

describe("warmMap", () => {
  it("fetches a published map's manifest and terrain once, and nothing for a generated one", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    const requested: string[] = [];
    const spy = ((input: string | URL | Request) => {
      requested.push(input instanceof Request ? input.url : String(input));
      return fromDisk(input);
    }) as typeof fetch;
    const world = maps.find((map) => map.manifest);
    if (!world) throw new Error("no published map");
    await warmMap(world, spy);
    expect(requested).toHaveLength(2);
    await warmMap(world, spy);
    expect(requested).toHaveLength(2);
    await warmMap(GENERATED_MAPS[0] as MapInfo, spy);
    expect(requested).toHaveLength(2);
  });

  it("forgets a failed fetch so that the next call tries again", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    const other = maps.filter((map) => map.manifest)[1] ?? maps.find((map) => map.manifest);
    if (!other) throw new Error("no published map");
    let calls = 0;
    const failing = (() => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 500 }));
    }) as typeof fetch;
    await warmMap(other, failing);
    await warmMap(other, failing);
    expect(calls).toBe(2);
  });
});
