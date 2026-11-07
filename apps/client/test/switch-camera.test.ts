import { describe, expect, it } from "vitest";
import { FlatCamera } from "../src/render/camera.ts";
import { GlobeCamera } from "../src/render/globe-camera.ts";
import { SwitchCamera } from "../src/render/switch-camera.ts";

const WIDTH = 200;
const HEIGHT = 100;

function cameras(): { flat: FlatCamera; globe: GlobeCamera; held: SwitchCamera } {
  const flat = new FlatCamera({ width: WIDTH, height: HEIGHT, wrapsX: true });
  flat.resize(800, 400);
  const globe = new GlobeCamera({ width: WIDTH, height: HEIGHT });
  return { flat, globe, held: new SwitchCamera(flat) };
}

describe("SwitchCamera (M7-07)", () => {
  it("passes every call to the camera of the view shown", () => {
    const { flat, held } = cameras();
    held.focus(50 * WIDTH + 120, 4);
    expect(flat.view()).toEqual(held.view());
    expect(held.zoom).toBe(flat.zoom);
    expect(held.scale).toBe(flat.scale);
    held.panBy(40, -20);
    held.zoomAt(1.5, 400, 200);
    expect(held.view()).toEqual(flat.view());
    const tile = held.screenToTile(400, 200);
    expect(tile).toBe(flat.screenToTile(400, 200));
    expect(held.tileToScreen(tile ?? 0)).toEqual(flat.tileToScreen(tile ?? 0));
    held.resize(640, 360);
    expect([held.viewportWidth, held.viewportHeight]).toEqual([640, 360]);
    expect(held.current).toBe(flat);
  });

  it("swaps to the other view's camera over the same tile, size and zoom", () => {
    const { flat, globe, held } = cameras();
    held.focus(40 * WIDTH + 30, 3);
    held.swap(globe, WIDTH, HEIGHT);
    expect(held.current).toBe(globe);
    expect([globe.viewportWidth, globe.viewportHeight]).toEqual([800, 400]);
    expect(Math.floor(globe.view().centerX)).toBe(30);
    expect(Math.floor(globe.view().centerY)).toBe(40);
    // Whatever the input does next moves the globe, and the flat camera stays where it was.
    const before = flat.view();
    held.panBy(25, 0);
    expect(flat.view()).toEqual(before);
    expect(held.view()).toEqual(globe.view());
    // And back: the flat camera follows where the globe went.
    held.swap(flat, WIDTH, HEIGHT);
    expect(held.current).toBe(flat);
    expect(Math.floor(flat.view().centerY)).toBe(Math.floor(globe.view().centerY));
  });

  it("keeps the centre on the map's last row when the view is centred past it", () => {
    const { globe, held } = cameras();
    held.focus((HEIGHT - 1) * WIDTH + 10, 1);
    held.swap(globe, WIDTH, HEIGHT);
    expect(globe.view().centerY).toBeLessThan(HEIGHT);
  });
});
