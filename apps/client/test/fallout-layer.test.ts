import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FalloutLayer } from "../src/render/fallout-layer.ts";
import type { FalloutZone } from "../src/render/renderer.ts";

const create = (): FalloutLayer =>
  new FalloutLayer({
    three: [
      THREE.Mesh,
      THREE.ShaderMaterial,
      THREE.InstancedBufferGeometry,
      THREE.InstancedBufferAttribute,
      THREE.BufferAttribute,
    ],
    map: { width: 100, height: 50, wrapsX: true },
    ground: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    scene: new THREE.Scene(),
    anchor: new THREE.Vector3(),
    moving: true,
    coarse: false,
  });

const zone = (over: Partial<FalloutZone> = {}): FalloutZone => ({
  x: 10,
  y: 5,
  radius: 8,
  heavy: false,
  secondsLeft: 30,
  seconds: 30,
  ...over,
});

describe("FalloutLayer", () => {
  it("draws every zone in one instanced call, north at the top", () => {
    const layer = create();
    expect(layer.set([zone(), zone({ x: 40, heavy: true, seconds: 90, secondsLeft: 60 })], 2)).toBe(
      true,
    );
    const geometry = layer.mesh.geometry;
    expect(geometry.instanceCount).toBe(2);
    const place = geometry.getAttribute("aZone");
    // Longest-lasting first, at the centre of the tile, y counted from the south.
    expect([place.getX(0), place.getY(0), place.getZ(0), place.getW(0)]).toEqual([
      40.5, 44.5, 8, 62,
    ]);
    expect(geometry.getAttribute("aInfo").getX(0)).toBe(90);
    layer.dispose();
  });

  it("changes nothing, and asks for no upload, when the zones stay the same", () => {
    const layer = create();
    layer.set([zone()], 0);
    // One tick later: the game counts down, the zone keeps its end.
    expect(layer.set([zone({ secondsLeft: 29.9 })], 0.1)).toBe(false);
    expect(layer.set([zone({ secondsLeft: 29.9 }), zone({ x: 20 })], 0.1)).toBe(true);
    expect(layer.set([], 0.2)).toBe(true);
    expect(layer.mesh.geometry.instanceCount).toBe(0);
    layer.dispose();
  });

  it("follows the game when its clock runs away from the view's", () => {
    const layer = create();
    layer.set([zone()], 0);
    expect(layer.set([zone({ secondsLeft: 20 })], 1)).toBe(true);
    expect(layer.mesh.geometry.getAttribute("aZone").getW(0)).toBe(21);
    layer.dispose();
  });

  it("asks for frames until the last zone has run out", () => {
    const layer = create();
    expect(layer.alive(0)).toBe(false);
    layer.set([zone()], 0);
    expect(layer.alive(29.9)).toBe(true);
    expect(layer.alive(30)).toBe(false);
    layer.dispose();
  });

  it("hatches each new zone the other way round", () => {
    const layer = create();
    layer.set([zone({ x: 10, y: 5 }), zone({ x: 11, y: 5, secondsLeft: 20 })], 0);
    const info = layer.mesh.geometry.getAttribute("aInfo");
    expect(info.getZ(0)).not.toBe(info.getZ(1));
    layer.dispose();
  });

  it("keeps the longest-lasting zones when there are too many", () => {
    const layer = create();
    const many = Array.from({ length: 40 }, (_, i) => zone({ x: i, secondsLeft: 1 + i }));
    layer.set(many, 0);
    expect(layer.mesh.geometry.instanceCount).toBe(32);
    expect(layer.mesh.geometry.getAttribute("aZone").getW(0)).toBe(40);
    layer.dispose();
  });
});
