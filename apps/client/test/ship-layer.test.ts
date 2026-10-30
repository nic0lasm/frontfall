import { describe, expect, it } from "vitest";
import { HULL_SIZES, ShipLayer, type Hull } from "../src/render/ship-layer.ts";

const kinds = new Uint8Array(8 * 4);
kinds[0] = 1;

const hull = (overrides: Partial<Hull> = {}): Hull => ({
  kind: "transport",
  x: 3,
  y: 2,
  heading: Math.PI / 2,
  speed: 4,
  color: "#E69F00",
  seed: 3,
  ...overrides,
});

const layer = (capacity = 4) =>
  new ShipLayer({ worldWidth: 8, worldHeight: 4, capacity, kinds, wrapsX: true });

describe("ShipLayer", () => {
  it("draws as many hulls as it is given, in the order given", () => {
    const ships = layer();
    ships.setHulls([hull({ kind: "trade", x: 1 }), hull({ kind: "warship", x: 5 })]);
    expect(ships.count).toBe(2);
    const position = ships.mesh.geometry.getAttribute("iPos");
    const kind = ships.mesh.geometry.getAttribute("iKind");
    expect([position.getX(0), position.getX(1)]).toEqual([1, 5]);
    expect([kind.getX(0), kind.getX(1)]).toEqual([0, 2]);
    ships.setHulls([]);
    expect(ships.count).toBe(0);
  });

  it("stops at its capacity instead of overrunning the buffers", () => {
    const ships = layer(2);
    ships.setHulls([hull(), hull(), hull()]);
    expect(ships.count).toBe(2);
  });

  it("hands the shader the heading, a speed from 0 to 1 and the owner's sRGB colour", () => {
    const ships = layer();
    ships.setHulls([hull({ heading: 1.25, speed: 100, color: "#FF8000" })]);
    const { geometry } = ships.mesh;
    expect(geometry.getAttribute("iAng").getX(0)).toBeCloseTo(1.25);
    expect(geometry.getAttribute("iKind").getZ(0)).toBe(1);
    const color = geometry.getAttribute("iCol");
    expect(color.getX(0)).toBe(1);
    expect(color.getY(0)).toBeCloseTo(128 / 255);
    expect(color.getZ(0)).toBe(0);
    ships.setHulls([hull({ speed: 0 })]);
    expect(geometry.getAttribute("iKind").getZ(0)).toBe(0);
  });

  it("holds the foam still when the player asks for less motion", () => {
    const ships = layer();
    expect(ships.mesh.material.uniforms.reduced?.value).toBe(0);
    ships.setMotion(false);
    expect(ships.mesh.material.uniforms.reduced?.value).toBe(1);
  });

  it("builds the light picture for the Saver profile", () => {
    const flat = new ShipLayer({
      worldWidth: 8,
      worldHeight: 4,
      capacity: 1,
      kinds,
      flat: true,
    });
    expect(flat.mesh.material.defines).toEqual({ FLAT: 1 });
    expect(layer().mesh.material.defines).toEqual({});
  });

  it("keeps a warship longer than a transport and a transport longer than a trade ship", () => {
    expect(HULL_SIZES.warship.tiles).toBeGreaterThan(HULL_SIZES.transport.tiles);
    expect(HULL_SIZES.transport.tiles).toBeGreaterThan(HULL_SIZES.trade.tiles);
    expect(HULL_SIZES.warship.minPixels).toBeGreaterThan(HULL_SIZES.transport.minPixels);
    expect(HULL_SIZES.transport.minPixels).toBeGreaterThan(HULL_SIZES.trade.minPixels);
  });
});
