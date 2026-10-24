import * as THREE from "three";
import { playerColor } from "../../apps/client/src/palette.ts";
import { GLOBE_FOV, globePose, globeRays } from "../../apps/client/src/render/globe-projection.ts";
import { TerritoryLayer } from "../../apps/client/src/render/territory-layer.ts";
import { UnitLayer } from "../../apps/client/src/render/unit-layer.ts";
import { summarize, type Summary } from "../engine/stats.ts";
import { ExpansionWorkload } from "../engine/workload.ts";

export interface RenderResult {
  readonly map: string;
  readonly viewport: string;
  readonly glRenderer: string;
  readonly maxTextureSize: number;
  readonly firstFrameMs: number;
  readonly staticFrame: Summary;
  readonly staticSubmit: Summary;
  readonly updateFrame: Summary;
  readonly fullUploadFrameMs: number;
  readonly texelsPerUpdate: number;
  readonly rowsPerUpdate: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly units: number;
  readonly gpuBytes: number;
}

declare global {
  interface Window {
    benchResult?: RenderResult;
    benchError?: string;
  }
}

const params = new URL(location.href).searchParams;
const number = (name: string, fallback: number): number => Number(params.get(name) ?? fallback);
const width = number("width", 4096);
const height = number("height", 2048);
const players = number("players", 64);
const unitCount = number("units", 10_000);
const frames = number("frames", 120);
const viewportWidth = number("viewportWidth", 1280);
const viewportHeight = number("viewportHeight", 720);
// The globe prototype (ADR 0005): the same layer ray-traced on a sphere, at a zoom where 1 fits the map height.
const globe = params.get("surface") === "sphere";
const globeZoom = number("zoom", 2);

function run(): RenderResult {
  const workload = new ExpansionWorkload({
    width,
    height,
    players,
    capturesPerTick: 4000,
    enclosureChecks: 64,
    enclosureLimit: 512,
    seed: 2026,
  });
  for (let i = 0; i < 200; i++) workload.tick();
  const { territory } = workload;
  territory.clearChanges();

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(viewportWidth, viewportHeight);
  document.body.append(renderer.domElement);
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  // Reading one pixel waits for the GPU, so timings include the work it did.
  const sync = (): void => {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };

  const layer = new TerritoryLayer({
    width,
    height,
    owners: territory.owners,
    terrain: workload.land,
    maxOwner: players,
    surface: globe ? "sphere" : "plane",
  });
  for (let player = 1; player <= players; player++) {
    layer.setOwnerColor(player, playerColor(player - 1).hex);
  }
  const units = new UnitLayer({ worldWidth: width, worldHeight: height, capacity: unitCount });
  for (let i = 0; i < unitCount; i++) {
    const player = (i % players) + 1;
    const borders = territory.borderCount(player);
    const tile = borders > 0 ? territory.borderTile(player, (i * 7919) % borders) : i;
    units.set(i, tile % width, Math.floor(tile / width), 0xffffff);
  }
  // Units are drawn flat only; the globe draws its markers with another layer.
  units.count = globe ? 0 : unitCount;

  const scene = new THREE.Scene();
  scene.add(layer.mesh, units.mesh);
  // The whole world height on screen: every pixel runs the territory shader.
  const aspect = viewportWidth / viewportHeight;
  const camera = new THREE.OrthographicCamera(
    (-height / 2) * aspect,
    (height / 2) * aspect,
    height / 2,
    -height / 2,
    0,
    10,
  );
  camera.position.set(width / 2, height / 2, 5);
  const halfHeight = height / 2 / globeZoom;
  const pose = globePose(
    { centerX: width / 2, centerY: height / 3, halfWidth: halfHeight * aspect, halfHeight },
    width,
    height,
    viewportWidth,
    viewportHeight,
  );
  layer.setGlobePose(globeRays(pose));
  const perspective = new THREE.PerspectiveCamera(GLOBE_FOV, aspect, 0.001, 100);

  const time = (frame: () => void): number => {
    const start = performance.now();
    frame();
    sync();
    return performance.now() - start;
  };
  const draw = (): void => {
    layer.flush();
    units.update(camera.position.x);
    renderer.render(scene, globe ? perspective : camera);
  };

  const firstFrameMs = time(draw);
  for (let i = 0; i < 10; i++) time(draw);

  const staticSamples: number[] = [];
  const submitSamples: number[] = [];
  for (let i = 0; i < frames; i++) {
    staticSamples.push(time(draw));
    // CPU side only: what the page's main thread spends issuing the frame.
    const start = performance.now();
    draw();
    submitSamples.push(performance.now() - start);
    sync();
  }
  const { calls, triangles } = renderer.info.render;

  const updateSamples: number[] = [];
  let texels = 0;
  let rows = 0;
  for (let i = 0; i < frames; i++) {
    workload.tick();
    const changes = territory.changes();
    rows += new Set(Array.from(changes, (tile) => Math.floor(tile / width))).size;
    updateSamples.push(
      time(() => {
        layer.markChanged(changes);
        texels += layer.flush();
        units.update(camera.position.x);
        renderer.render(scene, globe ? perspective : camera);
      }),
    );
    territory.clearChanges();
  }

  layer.markAllChanged();
  const fullUploadFrameMs = time(draw);

  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    map: `${String(width)}x${String(height)}${globe ? ` globe ×${String(globeZoom)}` : ""}`,
    viewport: `${String(viewportWidth)}x${String(viewportHeight)}`,
    glRenderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    firstFrameMs,
    staticFrame: summarize(staticSamples),
    staticSubmit: summarize(submitSamples),
    updateFrame: summarize(updateSamples),
    fullUploadFrameMs,
    texelsPerUpdate: Math.round(texels / frames),
    rowsPerUpdate: Math.round(rows / frames),
    drawCalls: calls,
    triangles,
    units: units.count,
    gpuBytes: layer.gpuBytes() + units.gpuBytes(),
  };
}

// Also printed on the page, for runs by hand in any browser.
const output = document.createElement("pre");
output.style.cssText =
  "position:fixed;inset:0;margin:0;padding:16px;color:#fff;font:12px monospace";
try {
  window.benchResult = run();
  output.textContent = JSON.stringify(window.benchResult, null, 2);
} catch (error) {
  window.benchError = error instanceof Error ? (error.stack ?? error.message) : String(error);
  output.textContent = window.benchError;
}
document.body.append(output);
