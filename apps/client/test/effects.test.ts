import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EffectsLayer } from "../src/render/effects-layer.ts";
import { EffectTracker, type Particle } from "../src/render/effects-track.ts";
import type { UnitMark } from "../src/render/renderer.ts";

const VIEW = { centerX: 50, centerY: 25, halfWidth: 40, halfHeight: 20 };

function tracker(moving = true): { tracker: EffectTracker; particles: Particle[] } {
  const particles: Particle[] = [];
  const made = new EffectTracker(
    (particle) => {
      particles.push(particle);
    },
    { width: 100, height: 50, wrapsX: true },
  );
  made.setMotion(moving);
  made.setView(VIEW, 0.1);
  return { tracker: made, particles };
}

const missile = (id: number, x: number, y = 25): UnitMark => ({
  id,
  x,
  y,
  color: "#FF7A47",
  kind: "missile",
});
const boat = (id: number, x: number, y = 25): UnitMark => ({ id, x, y, color: "#3366CC" });
const trade = (id: number, x: number): UnitMark => ({
  id,
  x,
  y: 25,
  color: "#3366CC",
  kind: "trade",
});

describe("EffectTracker", () => {
  it("starts nothing for units that are already there on the first frame", () => {
    const { tracker: t, particles } = tracker();
    t.ships([missile(1, 10), boat(2, 20)], 0);
    expect(particles).toEqual([]);
  });

  it("rings a launch, leaves the trail to the missile layer and flashes where it lands", () => {
    const { tracker: t, particles } = tracker();
    t.ships([], 0);
    t.ships([missile(1, 10)], 0.1);
    expect(particles.map((p) => p.shape)).toEqual(["ring"]);
    particles.length = 0;
    // The trail of a missile is the missile layer's (missile-layer.ts), not a dotted line.
    t.ships([missile(1, 14)], 0.2);
    expect(particles).toEqual([]);
    t.ships([], 0.3);
    // Vanishing is not landing: the end of the missile arrives apart.
    expect(particles).toEqual([]);
    t.struck(14, 25, false, 0.3);
    // A flash, a shock ring and seven sparks.
    expect(particles).toHaveLength(9);
    expect(particles.filter((p) => p.shape === "ring")).toHaveLength(1);
  });

  it("bursts a missile stopped in the air apart from a strike, and rings the air defense", () => {
    const { tracker: t, particles } = tracker();
    t.intercepted(14, 25, false, { x: 18, y: 25 }, 0.3);
    // A burst, a ring and five sparks, and the ring on the site.
    expect(particles).toHaveLength(8);
    expect(particles.filter((p) => p.shape === "ring")).toHaveLength(2);
    const strike = tracker();
    strike.tracker.struck(14, 25, false, 0.3);
    // The first particle of each is its burst.
    expect(particles[0]?.size1).toBeLessThan(strike.particles[0]?.size1 as number);
  });

  it("holds a strike or a stop to a single fading disc when motion is refused", () => {
    const still = tracker(false);
    still.tracker.struck(14, 25, true, 0);
    still.tracker.intercepted(14, 25, true, undefined, 0);
    expect(still.particles.map((p) => p.shape)).toEqual(["dot", "dot"]);
  });

  it("leaves a missile's trail to the missile layer: a flying missile starts no mark", () => {
    const { tracker: t, particles } = tracker();
    t.ships([missile(1, 10)], 0);
    t.ships([missile(1, 14)], 1);
    expect(particles).toEqual([]);
  });

  it("leaves a ship's wake to its hull: a sailing ship starts no mark", () => {
    const { tracker: t, particles } = tracker();
    t.ships([boat(1, 10), trade(2, 30)], 0);
    t.ships([boat(1, 18), trade(2, 38)], 1);
    expect(particles).toEqual([]);
  });

  it("splashes where a transport lands and rings a port when a trade ship docks", () => {
    const { tracker: t, particles } = tracker();
    t.ships([boat(1, 10), trade(2, 30)], 0);
    t.ships([], 1);
    const shapes = particles.map((p) => p.shape);
    expect(shapes.filter((s) => s === "ring")).toHaveLength(2);
    // Five drops, and the trade ship's coin.
    expect(shapes.filter((s) => s === "dot")).toHaveLength(6);
  });

  it("holds still when motion is reduced: trails stay, the rest is one fading disc", () => {
    const { tracker: t, particles } = tracker(false);
    t.ships([missile(1, 10), boat(2, 20)], 0);
    t.ships([missile(1, 14), boat(2, 24)], 0.1);
    expect(particles).toEqual([]);
    t.ships([], 0.2);
    // Only the transport's landing: the missile's end arrives apart.
    expect(particles).toHaveLength(1);
    t.struck(14, 25, false, 0.2);
    expect(particles).toHaveLength(2);
    for (const particle of particles) {
      expect(particle.shape).toBe("dot");
      expect(particle.size1).toBe(particle.size0);
      expect(particle.dx).toBe(0);
    }
    particles.length = 0;
    t.fronts([5, 6, 7, 8], new Uint16Array(100).fill(1), 0.3);
    expect(particles).toEqual([]);
  });

  it("ignores what happens out of view and caps a burst", () => {
    const { tracker: t, particles } = tracker();
    t.setView({ centerX: 10, centerY: 25, halfWidth: 5, halfHeight: 5 }, 0.1);
    t.ships([boat(1, 60)], 0);
    t.ships([], 1);
    expect(particles).toEqual([]);

    t.setView(VIEW, 0.1);
    const many = Array.from({ length: 30 }, (_, i) => boat(i + 10, 20 + (i % 10)));
    t.ships(many, 2);
    t.ships([], 3);
    // Eight landings of six marks each at most.
    expect(particles.length).toBeLessThanOrEqual(8 * 6);
  });

  it("sees a unit near the seam in a view on the other side", () => {
    const { tracker: t, particles } = tracker();
    t.setView({ centerX: 98, centerY: 25, halfWidth: 10, halfHeight: 10 }, 0.1);
    t.ships([boat(1, 2)], 0);
    t.ships([], 1);
    expect(particles.length).toBeGreaterThan(0);
  });

  it("sparks the front on owned land, a few at a time", () => {
    const { tracker: t, particles } = tracker();
    const owners = new Uint16Array(5000).fill(3);
    const tiles = Int32Array.from({ length: 400 }, (_, i) => 20 + i);
    t.fronts(tiles, owners, 5);
    expect(particles.length).toBeGreaterThan(0);
    expect(particles.filter((p) => p.size0 === 1.2).length).toBeLessThanOrEqual(10);
    particles.length = 0;
    t.fronts(tiles, new Uint16Array(5000), 5);
    expect(particles).toEqual([]);
  });
});

describe("EffectTracker, land taken", () => {
  it("rings a player's first land once, and breathes along a front at most twice a second", () => {
    const { tracker: t, particles } = tracker();
    const owners = new Uint16Array(5000);
    owners.fill(2, 2540, 2560);
    t.fronts(
      Int32Array.from({ length: 20 }, (_, i) => 2540 + i),
      owners,
      1,
    );
    expect(particles.filter((p) => p.shape === "ring")).toHaveLength(1);
    expect(particles.filter((p) => p.size1 === 9)).toHaveLength(1);
    particles.length = 0;
    t.fronts(
      Int32Array.from({ length: 20 }, (_, i) => 2540 + i),
      owners,
      1.2,
    );
    expect(particles.some((p) => p.shape === "ring")).toBe(false);
    expect(particles.some((p) => p.size1 === 9)).toBe(false);
  });

  it("takes a resynchronisation for no arrival, and holds still when motion is reduced", () => {
    const big = tracker();
    big.tracker.fronts(
      Int32Array.from({ length: 200 }, (_, i) => 2540 + i),
      new Uint16Array(5000).fill(2),
      1,
    );
    expect(big.particles.some((p) => p.shape === "ring")).toBe(false);
    const still = tracker(false);
    const owners = new Uint16Array(5000).fill(3, 2540, 2550);
    still.tracker.fronts(
      Int32Array.from({ length: 10 }, (_, i) => 2540 + i),
      owners,
      1,
    );
    expect(still.particles).toHaveLength(1);
    expect(still.particles[0]?.shape).toBe("dot");
    expect(still.particles[0]?.size1).toBe(still.particles[0]?.size0);
  });
});

describe("EffectTracker collapsed fronts (R-ATTACK-10)", () => {
  const tile = 25 * 100 + 50;

  it("rings the collapse in ember with a few sparks", () => {
    const { tracker: t, particles } = tracker();
    t.collapsed(tile, 2);
    const rings = particles.filter((p) => p.shape === "ring");
    expect(rings).toHaveLength(1);
    expect(rings[0]?.color).toBe("#F25C2A");
    expect(rings[0]?.life).toBeLessThanOrEqual(1.2);
    expect(particles.length - rings.length).toBe(6);
  });

  it("holds still as a single fading ring", () => {
    const { tracker: t, particles } = tracker(false);
    t.collapsed(tile, 2);
    expect(particles.map((p) => p.shape)).toEqual(["ring"]);
    expect(particles[0]?.size0).toBe(particles[0]?.size1);
  });

  it("caps the bursts alive at once, and frees them as they end", () => {
    const { tracker: t, particles } = tracker(false);
    for (let i = 0; i < 20; i++) t.collapsed(tile, 2);
    expect(particles).toHaveLength(8);
    t.collapsed(tile, 4);
    expect(particles).toHaveLength(9);
  });

  it("starts nothing out of view", () => {
    const { tracker: t, particles } = tracker();
    t.setView({ centerX: 10, centerY: 5, halfWidth: 3, halfHeight: 3 }, 0.1);
    t.collapsed(tile, 2);
    expect(particles).toEqual([]);
  });
});

describe("EffectTracker, capitals", () => {
  it("rings a fallen capital in gold with a flash, and one disc when motion is reduced", () => {
    const { tracker: t, particles } = tracker();
    t.capitalFell(2550, 1);
    expect(particles.map((p) => p.shape)).toEqual(["ring", "dot"]);
    const still = tracker(false);
    still.tracker.capitalFell(2550, 1);
    expect(still.particles).toHaveLength(1);
    expect(still.particles[0]?.size1).toBe(still.particles[0]?.size0);
  });

  it("pulses slowly around a threatened capital until it is safe, and not when motion is reduced", () => {
    const { tracker: t, particles } = tracker();
    t.setThreat(2550);
    expect(t.pulsing).toBe(true);
    t.tick(1);
    t.tick(1.5);
    expect(particles).toHaveLength(1);
    t.tick(3);
    expect(particles).toHaveLength(2);
    t.setThreat(undefined);
    expect(t.pulsing).toBe(false);
    t.tick(6);
    expect(particles).toHaveLength(2);
    const still = tracker(false);
    still.tracker.setThreat(2550);
    still.tracker.tick(1);
    expect(still.tracker.pulsing).toBe(false);
    expect(still.particles).toEqual([]);
  });
});

const EXPLOSION_PARTS = [
  THREE.Mesh,
  THREE.ShaderMaterial,
  THREE.BufferGeometry,
  THREE.BufferAttribute,
  THREE.Scene,
  THREE.OrthographicCamera,
  THREE.WebGLRenderTarget,
  THREE.Color,
] as const;

/** A renderer that only counts what the explosions ask of it: no WebGL in these tests. */
function stubRenderer(ratio = 1): THREE.WebGLRenderer & { drawn: THREE.Scene[] } {
  const drawn: THREE.Scene[] = [];
  return {
    drawn,
    getPixelRatio: () => ratio,
    getRenderTarget: () => null,
    getClearAlpha: () => 1,
    getClearColor: (color: THREE.Color) => color,
    setClearColor: () => undefined,
    setRenderTarget: () => undefined,
    clear: () => undefined,
    render: (scene: THREE.Scene) => {
      drawn.push(scene);
    },
  } as unknown as THREE.WebGLRenderer & { drawn: THREE.Scene[] };
}

describe("EffectsLayer", () => {
  const create = (): EffectsLayer =>
    new EffectsLayer({
      three: [
        THREE.Mesh,
        THREE.ShaderMaterial,
        THREE.InstancedBufferGeometry,
        THREE.InstancedBufferAttribute,
        THREE.BufferAttribute,
      ],
      map: { width: 100, height: 50, wrapsX: true, owners: new Uint16Array(5000) },
      scene: new THREE.Scene(),
      anchor: new THREE.Vector3(),
      moving: true,
      explosions: EXPLOSION_PARTS,
      renderer: stubRenderer(),
      saver: false,
    });
  const particle: Particle = {
    x: 10.5,
    y: 5.5,
    dx: 1,
    dy: -2,
    birth: 3,
    life: 2,
    size0: 1,
    size1: 4,
    minPixels: 3,
    color: "#FF0000",
    alpha: 0.5,
    shape: "ring",
  };

  it("keeps a mark alive for its life, and only then stops asking for frames", () => {
    const layer = create();
    expect(layer.alive(0)).toBe(false);
    layer.spawn(particle);
    expect(layer.alive(4.9)).toBe(true);
    expect(layer.alive(5)).toBe(false);
    layer.dispose();
  });

  it("draws every mark in one instanced call, north at the top", () => {
    const layer = create();
    layer.spawn(particle);
    layer.spawn({ ...particle, shape: "dot" });
    layer.update(3.5, 50, VIEW, 0.1);
    const geometry = layer.mesh.geometry;
    expect(geometry.instanceCount).toBe(2);
    const place = geometry.getAttribute("aPlace");
    expect([place.getX(0), place.getY(0), place.getZ(0), place.getW(0)]).toEqual([
      10.5, 44.5, 1, 2,
    ]);
    expect(geometry.getAttribute("aShape").getX(1)).toBe(0);
    expect(layer.gpuBytes()).toBe(768 * 14 * 4);
    layer.dispose();
  });

  it("overwrites the oldest mark when it is full", () => {
    const layer = create();
    for (let i = 0; i < 800; i++) layer.spawn({ ...particle, birth: i });
    layer.update(0, 0, VIEW, 1);
    expect(layer.mesh.geometry.instanceCount).toBe(768);
    layer.dispose();
  });

  it("starts a volumetric explosion on a strike, and the plain marks when motion is reduced", () => {
    const layer = create();
    const marks: Particle[] = [];
    const spy = vi.spyOn(layer, "spawn").mockImplementation((p) => void marks.push(p));
    layer.update(0, 50, VIEW, 0.1);
    layer.missileStruck(50, 25, false, 1);
    expect(layer.alive(2)).toBe(true);
    expect(marks).toEqual([]);
    layer.setMotion(false);
    layer.missileStruck(50, 25, false, 1);
    expect(marks.length).toBeGreaterThan(0);
    spy.mockRestore();
    layer.dispose();
  });

  it("plays four explosions at once, the fifth falls back to marks, and a free slot is reused", () => {
    const layer = create();
    const marks: Particle[] = [];
    vi.spyOn(layer, "spawn").mockImplementation((p) => void marks.push(p));
    layer.update(0, 50, VIEW, 0.1);
    for (let i = 0; i < 4; i++) layer.missileStruck(40 + i, 25, false, 1);
    expect(marks).toEqual([]);
    layer.missileStruck(60, 25, false, 1);
    expect(marks.length).toBeGreaterThan(0);
    marks.length = 0;
    layer.update(3.2, 50, VIEW, 0.1);
    layer.missileStruck(60, 25, false, 3.2);
    expect(marks).toEqual([]);
    layer.dispose();
  });

  it("draws a wide blast through a half-resolution target and a small one straight onto the map", () => {
    const small = stubRenderer(1);
    const wide = stubRenderer(5);
    const make = (renderer: THREE.WebGLRenderer): EffectsLayer =>
      new EffectsLayer({
        three: [
          THREE.Mesh,
          THREE.ShaderMaterial,
          THREE.InstancedBufferGeometry,
          THREE.InstancedBufferAttribute,
          THREE.BufferAttribute,
        ],
        map: { width: 100, height: 50, wrapsX: true, owners: new Uint16Array(5000) },
        scene: new THREE.Scene(),
        anchor: new THREE.Vector3(),
        moving: true,
        explosions: EXPLOSION_PARTS,
        renderer,
        saver: false,
      });
    const a = make(small);
    a.missileStruck(50, 25, false, 0);
    a.update(0.3, 50, VIEW, 0.1);
    expect(small.drawn).toHaveLength(0);
    expect(a.gpuBytes()).toBe(768 * 14 * 4);
    a.dispose();
    const b = make(wide);
    b.missileStruck(50, 25, false, 0);
    b.update(0.3, 50, VIEW, 0.1);
    expect(wide.drawn).toHaveLength(1);
    // The blast is in the scene the target is drawn from, and shown there.
    expect(wide.drawn[0]?.children.some((child) => child.visible)).toBe(true);
    // 26 css pixels at a ratio of 5 is 130 device pixels of radius, 332 texels a side at half resolution.
    expect(b.gpuBytes()).toBe(768 * 14 * 4 + 332 * 332 * 4);
    b.update(0.4, 50, VIEW, 0.1);
    expect(b.gpuBytes()).toBe(768 * 14 * 4 + 332 * 332 * 4);
    b.update(2.5, 50, VIEW, 0.1);
    expect(wide.drawn).toHaveLength(2);
    b.dispose();
  });
});
