import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GlobeCamera } from "../src/render/globe-camera.ts";
import {
  GLOBE_FOV,
  globeDistance,
  globePose,
  latLonToTile,
  projectLatLon,
  surfacePoint,
  tileToLatLon,
} from "../src/render/globe-projection.ts";

const WIDTH = 2048;
const HEIGHT = 1024;
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;

function camera(): GlobeCamera {
  const globe = new GlobeCamera({ width: WIDTH, height: HEIGHT });
  globe.resize(VIEW_WIDTH, VIEW_HEIGHT);
  return globe;
}

/** A three.js camera placed the way the globe renderer places it. */
function threeCamera(globe: GlobeCamera): THREE.PerspectiveCamera {
  const pose = globePose(globe.view(), WIDTH, HEIGHT, VIEW_WIDTH, VIEW_HEIGHT);
  const perspective = new THREE.PerspectiveCamera(GLOBE_FOV, VIEW_WIDTH / VIEW_HEIGHT, 0.001, 100);
  perspective.position.set(...pose.position);
  perspective.up.set(0, 1, 0);
  perspective.lookAt(0, 0, 0);
  perspective.updateMatrixWorld();
  perspective.updateProjectionMatrix();
  return perspective;
}

/** A small deterministic generator, so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("globe projection", () => {
  it("maps longitudes like three.js's sphere texture", () => {
    // SphereGeometry: x = -cos(2 pi u) sin(theta), z = sin(2 pi u) sin(theta), u from lon -180.
    for (const [lat, lon] of [
      [0, -180],
      [0, -90],
      [0, 0],
      [45, 90],
      [-60, 135],
    ] as const) {
      const u = (lon + 180) / 360;
      const theta = ((90 - lat) * Math.PI) / 180;
      const expected = [
        -Math.cos(2 * Math.PI * u) * Math.sin(theta),
        Math.cos(theta),
        Math.sin(2 * Math.PI * u) * Math.sin(theta),
      ];
      surfacePoint(lat, lon).forEach((value, i) => {
        expect(value).toBeCloseTo(expected[i] as number, 12);
      });
    }
  });

  it("gives a tile at the middle of the screen the flat map's size", () => {
    const globe = camera();
    globe.focus(512 * WIDTH + 1024, 4);
    const view = globe.view();
    const centre = projectLatLon(
      globePose(view, WIDTH, HEIGHT, VIEW_WIDTH, VIEW_HEIGHT),
      ...(Object.values(tileToLatLon(view.centerX, view.centerY + 1, WIDTH, HEIGHT)) as [
        number,
        number,
      ]),
    );
    // One row south of the middle is one tile's worth of pixels lower.
    expect(centre?.y).toBeCloseTo(VIEW_HEIGHT / 2 + globe.scale, 0);
    expect(globeDistance(view.halfHeight, HEIGHT)).toBeGreaterThan(1);
  });

  it("projects points where three.js draws them", () => {
    const globe = camera();
    globe.focus(300 * WIDTH + 1700, 3);
    const pose = globePose(globe.view(), WIDTH, HEIGHT, VIEW_WIDTH, VIEW_HEIGHT);
    const perspective = threeCamera(globe);
    const next = random(7);
    let compared = 0;
    for (let i = 0; i < 500; i++) {
      const lat = next() * 180 - 90;
      const lon = next() * 360 - 180;
      const screen = projectLatLon(pose, lat, lon);
      if (!screen) continue;
      const ndc = new THREE.Vector3(...surfacePoint(lat, lon)).project(perspective);
      expect(screen.x).toBeCloseTo(((ndc.x + 1) * VIEW_WIDTH) / 2, 6);
      expect(screen.y).toBeCloseTo(((1 - ndc.y) * VIEW_HEIGHT) / 2, 6);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe("GlobeCamera", () => {
  it("rejects a map without tiles and an empty zoom range", () => {
    expect(() => new GlobeCamera({ width: 0, height: 4 })).toThrow(RangeError);
    expect(() => new GlobeCamera({ width: 4, height: 4, minZoom: 4, maxZoom: 2 })).toThrow(
      RangeError,
    );
  });

  it.each([1, 4, 24])("picks the tile three.js's ray hits at zoom %d", (zoom) => {
    const globe = camera();
    globe.focus(200 * WIDTH + 64, zoom);
    const perspective = threeCamera(globe);
    const raycaster = new THREE.Raycaster();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const next = random(zoom);
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      const x = next() * VIEW_WIDTH;
      const y = next() * VIEW_HEIGHT;
      raycaster.setFromCamera(
        new THREE.Vector2((2 * x) / VIEW_WIDTH - 1, 1 - (2 * y) / VIEW_HEIGHT),
        perspective,
      );
      const point = raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
      const tile = globe.screenToTile(x, y);
      if (!point) {
        // Clicks off the planet select nothing.
        expect(tile).toBeUndefined();
        continue;
      }
      const lat = (Math.asin(point.y) * 180) / Math.PI;
      const lon = (Math.atan2(-point.z, point.x) * 180) / Math.PI;
      const expected = latLonToTile({ lat, lon }, WIDTH, HEIGHT);
      const column = Math.floor(expected.x);
      const row = Math.min(HEIGHT - 1, Math.floor(expected.y));
      // Within a hair of a tile edge both answers are right.
      const nearEdge =
        Math.abs(expected.x - Math.round(expected.x)) < 1e-6 ||
        Math.abs(expected.y - Math.round(expected.y)) < 1e-6;
      if (!nearEdge) expect(tile).toBe(row * WIDTH + column);
      hits++;
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("puts a tile back under itself and hides the far side", () => {
    const globe = camera();
    globe.focus(512 * WIDTH + 1024, 2);
    const front = 500 * WIDTH + 1000;
    const { x, y } = globe.tileToScreen(front);
    expect(globe.screenToTile(x, y)).toBe(front);
    // The antipode of the middle of the screen.
    const back = globe.tileToScreen(512 * WIDTH + 0);
    expect(back.x).toBeLessThan(-1000);
  });

  it("selects nothing in space around the planet", () => {
    const globe = camera();
    expect(globe.screenToTile(2, 2)).toBeUndefined();
    expect(globe.screenToTile(VIEW_WIDTH / 2, VIEW_HEIGHT / 2)).toBeDefined();
  });

  it("keeps the point under the pointer while zooming", () => {
    const globe = camera();
    globe.focus(400 * WIDTH + 900, 2);
    const before = globe.screenToTile(800, 300);
    globe.zoomAt(2, 800, 300);
    expect(globe.screenToTile(800, 300)).toBe(before);
  });

  it("drags the ground with the pointer, across the antimeridian too", () => {
    const globe = camera();
    globe.focus(512 * WIDTH + 2, 6);
    const tile = globe.screenToTile(640, 360) as number;
    globe.panBy(60, 0);
    const moved = globe.tileToScreen(tile);
    expect(moved.x).toBeCloseTo(640 + 60, -1);
    expect(globe.view().centerX).toBeGreaterThan(WIDTH - 20);
  });

  it("stops short of the poles", () => {
    const globe = camera();
    globe.panBy(0, 1e6);
    const { lat } = tileToLatLon(0, globe.view().centerY, WIDTH, HEIGHT);
    expect(lat).toBeCloseTo(85, 5);
  });
});
