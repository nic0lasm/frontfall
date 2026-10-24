import { describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, PointerGestures, wheelZoomFactor } from "../src/input/gestures.ts";
import { FlatCamera } from "../src/render/camera.ts";

const WIDTH = 512;

function setup(zoom = 4) {
  const camera = new FlatCamera({ width: WIDTH, height: 256 });
  camera.resize(1200, 800);
  camera.zoomAt(zoom, 600, 400);
  const onTileClick = vi.fn<(tile: number) => void>();
  const onHover = vi.fn<(tile: number | undefined) => void>();
  const gestures = new PointerGestures(camera, { onTileClick, onHover });
  return { camera, gestures, onTileClick, onHover };
}

describe("PointerGestures", () => {
  it("treats a press without movement as a click on the tile below", () => {
    const { camera, gestures, onTileClick } = setup();
    const expected = camera.screenToTile(300, 200);
    gestures.down({ id: 1, x: 300, y: 200 });
    gestures.move({ id: 1, x: 303, y: 204 });
    gestures.up({ id: 1, x: 303, y: 204 });
    expect(onTileClick).toHaveBeenCalledExactlyOnceWith(expected);
    expect(camera.view().centerX).toBe(256);
    expect(gestures.active).toBe(0);
  });

  it("opens the tile's menu after a long press held still, or a right click", () => {
    const camera = new FlatCamera({ width: WIDTH, height: 256 });
    camera.resize(1200, 800);
    const onTileClick = vi.fn<(tile: number) => void>();
    const onTileHold = vi.fn<(tile: number) => void>();
    const gestures = new PointerGestures(camera, { onTileClick, onTileHold });
    const tile = camera.screenToTile(300, 200);
    gestures.down({ id: 1, x: 300, y: 200, time: 1000 });
    gestures.up({ id: 1, x: 302, y: 201, time: 1000 + LONG_PRESS_MS });
    expect(onTileHold).toHaveBeenCalledExactlyOnceWith(tile);
    // A short press clicks; a long one that moved is a drag.
    gestures.down({ id: 1, x: 300, y: 200, time: 2000 });
    gestures.up({ id: 1, x: 300, y: 200, time: 2100 });
    gestures.down({ id: 2, x: 300, y: 200, time: 3000 });
    gestures.move({ id: 2, x: 340, y: 200, time: 3200 });
    gestures.up({ id: 2, x: 340, y: 200, time: 4000 });
    expect(onTileClick).toHaveBeenCalledExactlyOnceWith(tile);
    gestures.menu(300, 200);
    expect(onTileHold).toHaveBeenCalledTimes(2);
    // A mouse press carries no time: it clicks however long it is held.
    gestures.down({ id: 3, x: 300, y: 200 });
    gestures.up({ id: 3, x: 300, y: 200 });
    expect(onTileClick).toHaveBeenCalledTimes(2);
  });

  it("pans past the drag threshold, and then never clicks", () => {
    const { camera, gestures, onTileClick } = setup();
    const before = camera.view();
    gestures.down({ id: 1, x: 300, y: 300 });
    gestures.move({ id: 1, x: 310, y: 300 });
    gestures.move({ id: 1, x: 350, y: 325 });
    // Back within the threshold of the start: still a drag.
    gestures.up({ id: 1, x: 302, y: 300 });
    expect(onTileClick).not.toHaveBeenCalled();
    const after = camera.view();
    // The map follows the pointer: 50 px right moves the centre 50 px west.
    expect(after.centerX).toBeCloseTo(before.centerX - 50 / camera.scale);
    expect(after.centerY).toBeCloseTo(before.centerY - 25 / camera.scale);
  });

  it("keeps the tile under the finger while dragging", () => {
    const { camera, gestures } = setup();
    const grabbed = camera.screenToTile(400, 400);
    gestures.down({ id: 7, x: 400, y: 400 });
    for (let x = 400; x <= 900; x += 50) gestures.move({ id: 7, x, y: 420 });
    expect(camera.screenToTile(900, 420)).toBe(grabbed);
  });

  it("does not click past a pole", () => {
    const { gestures, onTileClick } = setup(1);
    gestures.down({ id: 1, x: 10, y: -5 });
    gestures.up({ id: 1, x: 10, y: -5 });
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("pinches around the midpoint of two fingers", () => {
    const { camera, gestures, onTileClick } = setup();
    const zoom = camera.zoom;
    const middle = camera.screenToTile(603, 307);
    gestures.down({ id: 1, x: 503, y: 307 });
    gestures.down({ id: 2, x: 703, y: 307 });
    gestures.move({ id: 1, x: 403, y: 307 });
    gestures.move({ id: 2, x: 803, y: 307 });
    expect(camera.zoom).toBeCloseTo(zoom * 2);
    expect(camera.screenToTile(603, 307)).toBe(middle);
    gestures.up({ id: 1, x: 403, y: 307 });
    gestures.up({ id: 2, x: 803, y: 307 });
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("moves the map with two fingers sliding together", () => {
    const { camera, gestures } = setup();
    // Away from tile edges, where rounding could pick the neighbour.
    const grabbed = camera.screenToTile(603, 307);
    gestures.down({ id: 1, x: 503, y: 307 });
    gestures.down({ id: 2, x: 703, y: 307 });
    gestures.move({ id: 1, x: 563, y: 347 });
    gestures.move({ id: 2, x: 763, y: 347 });
    expect(camera.screenToTile(663, 347)).toBe(grabbed);
  });

  it("carries on panning with the finger left after a pinch, without clicking", () => {
    const { camera, gestures, onTileClick } = setup();
    gestures.down({ id: 1, x: 500, y: 300 });
    gestures.down({ id: 2, x: 700, y: 300 });
    gestures.up({ id: 1, x: 500, y: 300 });
    const grabbed = camera.screenToTile(700, 300);
    gestures.move({ id: 2, x: 702, y: 301 });
    gestures.move({ id: 2, x: 650, y: 280 });
    expect(camera.screenToTile(650, 280)).toBe(grabbed);
    gestures.up({ id: 2, x: 650, y: 280 });
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("follows the two oldest fingers when a third one comes and goes", () => {
    const { camera, gestures } = setup();
    gestures.down({ id: 1, x: 500, y: 300 });
    gestures.down({ id: 2, x: 700, y: 300 });
    gestures.down({ id: 3, x: 150, y: 300 });
    // Not one of the pinching pair yet: nothing moves.
    gestures.move({ id: 3, x: 100, y: 300 });
    expect(camera.zoom).toBe(4);
    gestures.up({ id: 1, x: 500, y: 300 });
    // Now fingers 2 and 3, 600 px apart; spreading them to 1200 px doubles the zoom.
    gestures.move({ id: 3, x: -500, y: 300 });
    expect(camera.zoom).toBeCloseTo(8);
  });

  it("forgets cancelled and reset pointers without clicking", () => {
    const { gestures, onTileClick } = setup();
    gestures.down({ id: 1, x: 500, y: 300 });
    gestures.cancel(1);
    gestures.cancel(9);
    gestures.up({ id: 1, x: 500, y: 300 });
    gestures.down({ id: 2, x: 500, y: 300 });
    gestures.reset();
    gestures.up({ id: 2, x: 500, y: 300 });
    expect(onTileClick).not.toHaveBeenCalled();
    expect(gestures.active).toBe(0);
  });

  it("reports the hovered tile only when it changes", () => {
    const { camera, gestures, onHover } = setup();
    gestures.move({ id: 1, x: 600, y: 400 });
    gestures.move({ id: 1, x: 601, y: 400 });
    gestures.move({ id: 1, x: 700, y: 400 });
    gestures.leave();
    gestures.leave();
    expect(onHover.mock.calls).toEqual([
      [camera.screenToTile(600, 400)],
      [camera.screenToTile(700, 400)],
      [undefined],
    ]);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in when scrolling up and out when scrolling down", () => {
    expect(wheelZoomFactor(-100, 0, 800)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, 800)).toBeLessThan(1);
    expect(wheelZoomFactor(100, 0, 800) * wheelZoomFactor(-100, 0, 800)).toBeCloseTo(1);
  });

  it("converts lines and pages to pixels and caps a single event", () => {
    expect(wheelZoomFactor(3, 1, 800)).toBeCloseTo(wheelZoomFactor(120, 0, 800));
    expect(wheelZoomFactor(1, 2, 800)).toBeCloseTo(wheelZoomFactor(400, 0, 800));
    expect(wheelZoomFactor(10_000, 0, 800)).toBeCloseTo(wheelZoomFactor(400, 0, 800));
  });
});
