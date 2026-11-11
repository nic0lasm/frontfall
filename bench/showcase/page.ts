/**
 * A fixed scene on a published map, drawn by the game's own renderer: the same
 * owners, fronts, buildings and ships on every run, so that two looks of the
 * map can be put side by side. Query: map, zoom (1 fits the map height),
 * x and y (centre, as fractions of the map), players, ratio (device pixels), view=globe.
 */
import { TileKind } from "@frontfall/engine";
import { playerColor } from "../../apps/client/src/palette.ts";
import { fetchManifest, fetchMapData, fetchMaps } from "../../apps/client/src/game/maps.ts";
import { FlatCamera } from "../../apps/client/src/render/camera.ts";
import {
  createCamera,
  createRenderer,
  loadPieces,
  type StructureMark,
  type UnitMark,
} from "../../apps/client/src/render/renderer.ts";

declare global {
  interface Window {
    showcaseReady?: boolean;
    showcaseError?: string;
  }
}

const params = new URL(location.href).searchParams;
const number = (name: string, fallback: number): number => Number(params.get(name) ?? fallback);
const mapId = params.get("map") ?? "europe";
const zoom = number("zoom", 1);
const players = number("players", 14);
// ?view=globe: the same scene on the globe, for a map of the whole planet.
const globe = params.get("view") === "globe";

/** A small generator with a fixed seed, so that every run places the same things. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function run(): Promise<void> {
  const base = new URL("/@fs" + decodeURIComponent(params.get("public") ?? ""), location.href);
  const maps = await fetchMaps(base.href);
  const info = maps.find((map) => map.id === mapId);
  if (!info) throw new Error(`no map ${mapId}`);
  const map = await fetchMapData(info, await fetchManifest(info));
  const { width, height, kinds } = map;
  const owners = new Uint16Array(width * height);
  const rand = random(2026);

  // Seeds on land, then a breadth-first growth with a ragged pace, up to a share of the land.
  const land: number[] = [];
  for (let i = 0; i < kinds.length; i++) if (kinds[i] !== TileKind.Water) land.push(i);
  const queue: number[][] = [];
  for (let p = 1; p <= players; p++) {
    const tile = land[Math.floor(rand() * land.length)] as number;
    if (owners[tile] !== 0) continue;
    owners[tile] = p;
    queue[p] = [tile];
  }
  const target = land.length * number("share", 0.62);
  let owned = players;
  const lastTaken: number[] = [];
  while (owned < target) {
    let grew = false;
    for (let p = 1; p <= players; p++) {
      const front = queue[p];
      if (!front || front.length === 0) continue;
      const steps = Math.ceil(front.length * (0.25 + rand() * 0.5));
      const next: number[] = [];
      for (let s = 0; s < front.length; s++) {
        const tile = front[s] as number;
        if (s > steps) {
          next.push(tile);
          continue;
        }
        const x = tile % width;
        const y = (tile - x) / width;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = (x + dx + width) % width;
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          const n = ny * width + nx;
          if (owners[n] !== 0 || kinds[n] === TileKind.Water) continue;
          if (rand() < 0.3) {
            next.push(tile);
            continue;
          }
          owners[n] = p;
          owned++;
          next.push(n);
          if (owned > target - 4000) lastTaken.push(n);
          grew = true;
        }
      }
      queue[p] = next;
    }
    if (!grew) break;
  }

  await loadPieces();
  const view = createRenderer(
    {
      width,
      height,
      kinds,
      wrapsX: map.wrapsX,
      relief: map.relief,
      latitudes: map.latitudes,
      groundSource: map.source && { id: map.id, sha256: map.source.sha256 },
      flat: false,
      phone: params.has("phone"),
      owners,
      maxOwner: players,
    },
    globe ? "globe" : "flat",
  );
  for (let p = 1; p <= players; p++) view.setPlayerColor(p, playerColor(p - 1).hex);
  view.setHighlight(1);
  view.setMotion(true);
  document.body.append(view.canvas);
  const camera = globe
    ? createCamera({ width, height, wrapsX: map.wrapsX }, "globe")
    : new FlatCamera({ width, height, wrapsX: map.wrapsX, maxZoom: 64 });
  const w = innerWidth;
  const h = innerHeight;
  camera.resize(w, h);
  view.setPixelRatio(number("ratio", devicePixelRatio));
  view.resize(w, h);
  const cx = Math.floor(number("x", 0.5) * width);
  const cy = Math.floor(number("y", 0.5) * height);
  camera.focus(cy * width + cx, zoom);

  // Structures: on a few tiles of each player's land, and ports on its coast.
  const structures: StructureMark[] = [];
  const types = ["city", "city", "fort", "silo", "airDefense", "palace"] as const;
  const byOwner = new Map<number, number[]>();
  for (const tile of land) {
    const owner = owners[tile] as number;
    if (owner === 0) continue;
    let list = byOwner.get(owner);
    if (!list) byOwner.set(owner, (list = []));
    list.push(tile);
  }
  const coast = (tile: number): boolean => {
    const x = tile % width;
    return [1, -1, width, -width].some((d) => {
      const n = tile + d;
      return (
        n >= 0 && n < kinds.length && kinds[n] === TileKind.Water && Math.abs((n % width) - x) <= 1
      );
    });
  };
  const ships: UnitMark[] = [];
  let shipId = 1;
  for (const [owner, tiles] of byOwner) {
    const color = playerColor(owner - 1).hex;
    const count = Math.min(9, Math.floor(tiles.length / 900) + 2);
    for (let i = 0; i < count; i++) {
      const tile = tiles[Math.floor(rand() * tiles.length)] as number;
      const type = i === 0 ? "capital" : (types[Math.floor(rand() * types.length)] ?? "city");
      structures.push({
        x: tile % width,
        y: Math.floor(tile / width),
        type,
        color,
        ready: rand() > 0.1,
      });
    }
    const coastal = tiles.filter(coast);
    for (let i = 0; i < Math.min(3, coastal.length); i++) {
      const tile = coastal[Math.floor(rand() * coastal.length)] as number;
      structures.push({
        x: tile % width,
        y: Math.floor(tile / width),
        type: "port",
        color,
        ready: true,
      });
      // A ship out at sea beside the port, sailing away from it.
      for (let r = 4; r < 30; r++) {
        const angle = rand() * Math.PI * 2;
        const sx = (tile % width) + Math.cos(angle) * r;
        const sy = Math.floor(tile / width) + Math.sin(angle) * r;
        const st = Math.floor(sy) * width + Math.floor(sx);
        if (st > 0 && st < kinds.length && kinds[st] === TileKind.Water) {
          const kind = (["trade", undefined, "warship"] as const)[Math.floor(rand() * 3)];
          ships.push({
            id: shipId++,
            x: sx,
            y: sy,
            color,
            ...(kind ? { kind } : {}),
            heading: angle,
            speed: 3,
          });
          break;
        }
      }
    }
  }
  view.setStructures(structures);
  view.setShips(ships);

  const draw = (): void => {
    view.render(camera.view());
  };
  draw();
  // The first frame of a software renderer takes seconds: the front is lit after it, then drawn.
  view.markChanged(lastTaken);
  let frames = 0;
  const loop = (): void => {
    draw();
    if (++frames === number("frames", 12)) {
      // ?time=n: the median of n frames drawn and waited for, in milliseconds.
      const count = number("time", 0);
      const times: number[] = [];
      for (let i = 0; i < count; i++) {
        const start = performance.now();
        draw();
        view.sync?.();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      (window as unknown as { showcaseTime?: number | undefined }).showcaseTime =
        times[Math.floor(count / 2)];
      window.showcaseReady = true;
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

run().catch((error: unknown) => {
  window.showcaseError = String(error instanceof Error ? (error.stack ?? error.message) : error);
  console.error(error);
});
