import { Disable } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/solo-game.ts";
import { gameKey, type KeyState } from "../src/ui/screen/game-keys.ts";
import { Orders } from "../src/ui/screen/orders.ts";
import { MISSILE_COLOR, sailing, shipMarks, shipTiles } from "../src/ui/screen/ship-motion.ts";

const idle: KeyState = {
  overlay: false,
  menu: false,
  mode: "attack",
  watching: false,
  disabled: 0,
  globeAllowed: false,
};

function key(code: string, key = code, modifiers: Partial<KeyboardEvent> = {}) {
  return { code, key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe("game keys", () => {
  it("lets Esc close a dialog, then the player menu, then a build mode, then pause", () => {
    const esc = key("Escape");
    expect(gameKey(esc, { ...idle, overlay: true, menu: true, mode: "city" })).toEqual({
      type: "closeOverlay",
    });
    expect(gameKey(esc, { ...idle, menu: true, mode: "city" })).toEqual({ type: "closeMenu" });
    expect(gameKey(esc, { ...idle, mode: "city" })).toEqual({ type: "mode", mode: "attack" });
    expect(gameKey(esc, idle)).toEqual({ type: "pause" });
  });

  it("picks build modes by the key's place, except those the game leaves out or in a replay", () => {
    expect(gameKey(key("KeyC", "c"), idle)).toEqual({ type: "mode", mode: "city" });
    expect(gameKey(key("KeyL", "l"), { ...idle, disabled: Disable.Silo })).toBeUndefined();
    expect(gameKey(key("KeyM", "m"), { ...idle, disabled: Disable.Silo })).toBeUndefined();
    expect(gameKey(key("KeyC", "c"), { ...idle, watching: true })).toBeUndefined();
  });

  it("sets the attack ratio from the digits, 0 for all of it", () => {
    expect(gameKey(key("Digit3", "3"), idle)).toEqual({ type: "ratio", percent: 30 });
    expect(gameKey(key("Digit0", "0"), idle)).toEqual({ type: "ratio", percent: 100 });
  });

  it("switches the view only where the globe is allowed, and leaves modified keys alone", () => {
    expect(gameKey(key("KeyG", "g"), idle)).toBeUndefined();
    expect(gameKey(key("KeyG", "g"), { ...idle, globeAllowed: true })).toEqual({
      type: "switchView",
    });
    expect(gameKey(key("KeyH", "h"), idle)).toEqual({ type: "help" });
    expect(gameKey(key("KeyP", "p", { ctrlKey: true }), idle)).toBeUndefined();
  });
});

const sea = {
  boats: [{ id: 1, player: 2, tile: 12 }],
  tradeShips: [{ id: 1, player: 3, tile: 20 }],
  warships: [],
  missiles: [{ id: 1, player: 2, tile: 5, heavy: true }],
} as unknown as GameUpdate;

describe("ship motion", () => {
  it("keeps transports, trade ships and missiles with the same number apart", () => {
    expect(shipTiles(sea).size).toBe(3);
    expect(shipTiles(undefined).size).toBe(0);
    expect(sailing(sea)).toBe(true);
    expect(sailing(undefined)).toBe(false);
  });

  it("glides each ship from its last tile, the short way across the seam", () => {
    const previous = shipTiles({
      ...sea,
      boats: [{ id: 1, player: 2, tile: 19 }],
    } as unknown as GameUpdate);
    const marks = shipMarks(
      sea,
      previous,
      0.5,
      { width: 10, wrapsX: true },
      (p) => `c${String(p)}`,
    );
    // From x 9 to x 2 on a map 10 wide: east across the seam, not 7 tiles west.
    expect(marks[0]).toEqual({ id: 1, x: 10.5, y: 1, color: "c2" });
    expect(marks[1]).toEqual({ id: -1, x: 0, y: 2, color: "c3", kind: "trade" });
    expect(marks[2]).toEqual({
      id: 2 ** 41 + 1,
      x: 5,
      y: 0,
      color: MISSILE_COLOR,
      kind: "heavyMissile",
    });
  });
});

describe("orders", () => {
  function setup(update: Partial<GameUpdate> | undefined, held = false) {
    const sent: unknown[] = [];
    const firstOrders: number[] = [];
    const orders = new Orders(
      {
        click: (...args) => sent.push(["click", ...args]),
        sendOrder: (order) => sent.push(order),
      },
      {
        latest: () => update as GameUpdate | undefined,
        held: () => held,
        ratio: () => 50,
        tracker: { firstOrder: (now: number) => firstOrders.push(now) } as never,
      },
    );
    return { orders, sent, firstOrders };
  }
  const playing = { phase: "play", you: 1, players: [{ id: 1, troops: 101, gold: 1 }] } as never;

  it("sends nothing while the game is held, won or not started", () => {
    for (const { orders, sent } of [
      setup(undefined),
      setup(playing, true),
      setup({ ...(playing as object), winner: 2 }),
    ]) {
      expect(orders.click(3, "attack", 1)).toBe(false);
      expect(orders.diplomatic("ally", 2)).toBe(false);
      orders.retreat(1);
      orders.quick(2, 0);
      expect(sent).toEqual([]);
    }
  });

  it("lets clicks go out in the spawn phase, but neither diplomacy nor the usage report", () => {
    const { orders, sent, firstOrders } = setup({ phase: "spawn", players: [] });
    expect(orders.click(3, "attack", 1)).toBe(true);
    expect(orders.diplomatic("ally", 2)).toBe(false);
    expect(sent).toEqual([["click", 3, 50, "attack", 1]]);
    expect(firstOrders).toEqual([]);
  });

  it("gives the ratio's share and notes the first order", () => {
    const { orders, sent, firstOrders } = setup(playing);
    orders.gift(2, "troops");
    orders.gift(2, "gold");
    expect(orders.diplomatic("embargo", 2, false)).toBe(true);
    expect(sent).toEqual([
      { type: "gift", target: 2, troops: 50, gold: 0 },
      { type: "embargo", target: 2, on: 0 },
    ]);
    expect(firstOrders).toHaveLength(2);
  });
});
