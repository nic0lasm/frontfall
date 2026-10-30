import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  blastScale,
  courseOf,
  fixAt,
  groundHeading,
  headingAt,
  trailOf,
  type Puff,
} from "../src/render/missile-flight.ts";
import { MissileLayer } from "../src/render/missile-layer.ts";
import type { UnitMark } from "../src/render/renderer.ts";

const MAP = { width: 1000, height: 500, wrapsX: true };

const mark = (from: [number, number], to: [number, number], flown: number): UnitMark => ({
  id: 1,
  x: from[0],
  y: from[1],
  color: "#FF7A47",
  kind: "missile",
  speed: 20,
  from: { x: from[0], y: from[1] },
  to: { x: to[0], y: to[1] },
  flown,
});

describe("missile course", () => {
  it("lays the route in world tiles, north up, and lifts it by the arc", () => {
    const course = courseOf(mark([100, 300], [300, 300], 0), MAP);
    expect(course).toBeDefined();
    if (!course) return;
    expect(course.x).toBe(100.5);
    expect(course.y).toBe(199.5);
    expect(course.length).toBe(200);
    expect(course.lift).toBeCloseTo(32);
    const start = fixAt(course, 0);
    const top = fixAt(course, 0.5);
    const end = fixAt(course, 1);
    expect(start.alt).toBe(0);
    expect(end.alt).toBe(0);
    expect(start.y).toBe(start.gy);
    expect(end.x).toBeCloseTo(300.5);
    expect(end.y).toBeCloseTo(end.gy);
    expect(top.alt).toBe(1);
    expect(top.y - top.gy).toBeCloseTo(course.lift);
  });

  it("caps the lift of a long shot on a small map and scales it on a large one", () => {
    const far = courseOf(mark([0, 100], [450, 100], 0), MAP);
    expect(far?.lift).toBeCloseTo(36 * blastScale(MAP));
    expect(blastScale({ width: 2048, height: 1024, wrapsX: true })).toBeCloseTo(2);
  });

  it("takes the short way across the seam", () => {
    const course = courseOf(mark([980, 250], [20, 250], 0), MAP);
    expect(course?.dx).toBe(40);
    expect(courseOf(mark([980, 250], [20, 250], 0), { ...MAP, wrapsX: false })?.dx).toBe(-960);
  });

  it("says nothing of a missile that does not say where it goes", () => {
    expect(courseOf({ id: 1, x: 3, y: 4, color: "#FFF", kind: "missile" }, MAP)).toBeUndefined();
  });

  it("points the nose up on the climb, along the ground at the top and down on the way in", () => {
    const course = courseOf(mark([100, 300], [300, 300], 0), MAP);
    if (!course) throw new Error("no course");
    expect(groundHeading(course)).toBeCloseTo(0);
    expect(headingAt(course, 0.05)).toBeGreaterThan(0);
    expect(headingAt(course, 0.5)).toBeCloseTo(0);
    expect(headingAt(course, 0.95)).toBeLessThan(0);
  });

  it("leaves puffs back along the path, oldest last, never before the launch", () => {
    const course = courseOf(mark([100, 300], [300, 300], 0), MAP);
    if (!course) throw new Error("no course");
    const puffs: Puff[] = [];
    trailOf(course, 0.5, 20, 2.4, 4, 0, (puff) => puffs.push(puff));
    // 2.4 s at 20 tiles a second reaches 48 tiles back, one puff every 4.
    expect(puffs).toHaveLength(13);
    expect(puffs[0]?.age).toBe(0);
    expect(puffs.at(-1)?.age).toBeCloseTo(1, 1);
    expect((puffs[1]?.x as number) < (puffs[0]?.x as number)).toBe(true);
    puffs.length = 0;
    // Just launched: the trail stops at the silo.
    trailOf(course, 0.05, 20, 2.4, 4, 0, (puff) => puffs.push(puff));
    expect(puffs).toHaveLength(3);
    expect(Math.min(...puffs.map((p) => p.x))).toBeGreaterThanOrEqual(course.x);
  });

  it("ages a trail whose missile has ended, until nothing is left", () => {
    const course = courseOf(mark([100, 300], [300, 300], 0), MAP);
    if (!course) throw new Error("no course");
    const early: Puff[] = [];
    trailOf(course, 1, 20, 2.4, 4, 0.5, (puff) => early.push(puff));
    expect(early[0]?.age).toBeCloseTo(0.5 / 2.4);
    const gone: Puff[] = [];
    trailOf(course, 1, 20, 2.4, 4, 2.4, (puff) => gone.push(puff));
    expect(gone.every((puff) => puff.age >= 1)).toBe(true);
  });
});

describe("MissileLayer", () => {
  const create = (moving = true, rich = true): MissileLayer =>
    new MissileLayer({
      three: [
        THREE.Mesh,
        THREE.ShaderMaterial,
        THREE.InstancedBufferGeometry,
        THREE.InstancedBufferAttribute,
        THREE.BufferAttribute,
      ],
      map: MAP,
      scene: new THREE.Scene(),
      anchor: new THREE.Vector3(),
      moving,
      rich,
    });
  const instances = (layer: MissileLayer): [number, number] => [
    layer.meshes[0]?.geometry.instanceCount ?? -1,
    layer.meshes[layer.meshes.length - 2]?.geometry.instanceCount ?? -1,
  ];

  it("draws a missile in flight, with a trail behind it, and keeps frames coming", () => {
    const layer = create();
    expect(layer.alive(0)).toBe(false);
    layer.ships([mark([100, 300], [300, 300], 0.5)], 1);
    layer.update(1, 0, 1);
    const [missiles, puffs] = instances(layer);
    expect(missiles).toBe(1);
    expect(puffs).toBeGreaterThan(5);
    expect(layer.alive(1)).toBe(true);
  });

  it("leaves a fading trail when the missile ends, then lets go", () => {
    const layer = create();
    layer.ships([mark([100, 300], [300, 300], 0.9)], 1);
    layer.ships([], 1.1);
    layer.update(1.2, 0, 1);
    expect(instances(layer)[0]).toBe(0);
    expect(instances(layer)[1]).toBeGreaterThan(0);
    expect(layer.alive(1.2)).toBe(true);
    expect(layer.alive(4)).toBe(false);
    layer.update(4, 0, 1);
    expect(instances(layer)[1]).toBe(0);
  });

  it("leaves no trail to a missile already gone on its first frame, or one that never left", () => {
    const layer = create();
    layer.ships([], 0);
    layer.ships([mark([100, 300], [300, 300], 0)], 0.1);
    layer.ships([], 0.2);
    expect(layer.alive(0.2)).toBe(false);
  });

  it("draws a missile that does not say where it goes, without a circle or a trail", () => {
    const layer = create();
    layer.ships([{ id: 3, x: 40, y: 40, color: "#FFF", kind: "heavyMissile", heading: 0 }], 1);
    layer.update(1, 0, 1);
    expect(instances(layer)).toEqual([1, 0]);
  });

  it("leaves out the shadow of the light picture and thins its trail", () => {
    const full = create(true, true);
    const light = create(true, false);
    expect(full.meshes).toHaveLength(4);
    expect(light.meshes).toHaveLength(3);
    for (const layer of [full, light]) {
      layer.ships([mark([100, 300], [300, 300], 0.5)], 1);
      layer.update(1, 0, 1);
    }
    expect(instances(light)[1]).toBeLessThan(instances(full)[1]);
  });

  it("holds the same missiles still when motion is refused", () => {
    const layer = create(false);
    layer.ships([mark([100, 300], [300, 300], 0.5)], 1);
    layer.update(1, 0, 1);
    expect(instances(layer)[0]).toBe(1);
    expect(layer.meshes[0]?.material.uniforms.moving?.value).toBe(0);
    layer.setMotion(true);
    expect(layer.meshes[0]?.material.uniforms.moving?.value).toBe(1);
  });
});
