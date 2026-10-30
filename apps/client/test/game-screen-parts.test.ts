import { Disable } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/solo-game.ts";
import { gameKey, typingIn, type KeyState } from "../src/ui/screen/game-keys.ts";
import { Orders } from "../src/ui/screen/orders.ts";
import { MISSILE_COLOR, sailing, ShipMotion } from "../src/ui/screen/ship-motion.ts";

const idle: KeyState = {
  overlay: false,
  menu: false,
  mode: "attack",
  watching: false,
  disabled: 0,
  globeAllowed: false,
};

function key(code: string, key = code, modifiers: Partial<KeyboardEvent> = {}) {
  return {
    code,
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
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

  it("changes the pace with T, except in a replay (R-MODE-07)", () => {
    expect(gameKey(key("KeyT", "t"), idle)).toEqual({ type: "speed" });
    expect(gameKey(key("KeyT", "t"), { ...idle, watching: true })).toBeUndefined();
  });

  it("picks the building of that number from the digits, in games that have it", () => {
    expect(gameKey(key("Digit1", "1"), idle)).toEqual({ type: "mode", mode: "city" });
    expect(gameKey(key("Digit4", "4"), idle)).toEqual({ type: "mode", mode: "port" });
    expect(gameKey(key("Digit9", "9"), idle)).toEqual({ type: "mode", mode: "heavyMissile" });
    // Picking it again is the screen's business: the key says the same thing.
    expect(gameKey(key("Digit1", "1"), { ...idle, mode: "city" })).toEqual({
      type: "mode",
      mode: "city",
    });
    // Numbers stay with their building when a game leaves another out, and nothing has 0.
    expect(gameKey(key("Digit5", "5"), { ...idle, disabled: Disable.Silo })).toBeUndefined();
    expect(gameKey(key("Digit4", "4"), { ...idle, disabled: Disable.Silo })).toEqual({
      type: "mode",
      mode: "port",
    });
    expect(gameKey(key("Digit0", "0"), idle)).toBeUndefined();
    expect(gameKey(key("Digit1", "1"), { ...idle, watching: true })).toBeUndefined();
  });

  it("sets the attack ratio from Shift and the digits, 0 for all of it", () => {
    const shift = { shiftKey: true };
    expect(gameKey(key("Digit3", "#", shift), idle)).toEqual({ type: "ratio", percent: 30 });
    expect(gameKey(key("Digit0", ")", shift), idle)).toEqual({ type: "ratio", percent: 100 });
    expect(gameKey(key("Digit3", "#", shift), { ...idle, watching: true })).toEqual({
      type: "ratio",
      percent: 30,
    });
  });

  it("leaves the keys to a field the player types into, but not to a slider or a button", () => {
    const field = (tagName: string, type?: string) => ({ tagName, type }) as unknown as EventTarget;
    expect(typingIn(field("INPUT", "text"))).toBe(true);
    expect(typingIn(field("INPUT", "search"))).toBe(true);
    expect(typingIn(field("TEXTAREA"))).toBe(true);
    expect(typingIn(field("SELECT"))).toBe(true);
    expect(typingIn(field("INPUT", "range"))).toBe(false);
    expect(typingIn(field("BUTTON"))).toBe(false);
    expect(typingIn(null)).toBe(false);
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
  tick: 11,
  missiles: [
    {
      id: 1,
      player: 2,
      tile: 5,
      heavy: true,
      from: 0,
      to: 9,
      radius: 3,
      launchedAt: 8,
      arrivesAt: 14,
    },
  ],
} as unknown as GameUpdate;

describe("ship motion", () => {
  const map = { width: 10, wrapsX: true };
  const color = (p: number) => `c${String(p)}`;
  const at = (tick: number, tile: number, extra = {}): GameUpdate =>
    ({
      tick,
      boats: [{ id: 1, player: 2, tile, ...extra }],
      tradeShips: [],
      warships: [],
      missiles: [],
    }) as unknown as GameUpdate;

  it("keeps transports, trade ships and missiles with the same number apart", () => {
    const motion = new ShipMotion();
    motion.tick({ ...sea, tick: 1 }, map, 10, 0);
    expect(motion.marks(1, 0, color)).toHaveLength(3);
    expect(sailing(sea)).toBe(true);
    expect(sailing(undefined)).toBe(false);
  });

  it("glides each ship from its last tile, the short way across the seam", () => {
    const motion = new ShipMotion();
    motion.tick({ ...sea, tick: 10, boats: [{ id: 1, player: 2, tile: 19 }] } as never, map, 10, 0);
    motion.tick({ ...sea, tick: 11 }, map, 10, 100);
    const marks = motion.marks(0.5, 100, color);
    // From x 9 to x 2 on a map 10 wide: east across the seam, not 7 tiles west.
    expect(marks[0]).toMatchObject({ id: 1, x: 10.5, y: 1, color: "c2" });
    expect(marks[1]).toMatchObject({ id: -1, x: 0, y: 2, color: "c3", kind: "trade" });
    expect(marks[2]).toMatchObject({
      id: 2 ** 41 + 1,
      x: 5,
      y: 0,
      color: MISSILE_COLOR,
      kind: "heavyMissile",
      from: { x: 0, y: 0 },
      to: { x: 9, y: 0 },
      // 2.5 of its 6 ticks of flight, half way through the tick just played.
      flown: 2.5 / 6,
    });
  });

  it("points a ship along its course and turns it smoothly the short way", () => {
    const motion = new ShipMotion();
    motion.tick(at(1, 15), { width: 10, wrapsX: false }, 10, 0);
    motion.tick(at(2, 16), { width: 10, wrapsX: false }, 10, 100);
    const east = motion.marks(1, 100, color)[0];
    expect(east?.heading).toBeCloseTo(0);
    expect(east?.speed).toBeCloseTo(10);
    // Turning to the south: half the way toward a quarter turn, not a snap.
    motion.tick(at(3, 26), { width: 10, wrapsX: false }, 10, 200);
    const start = motion.marks(0, 200, color)[0];
    const end = motion.marks(1, 200, color)[0];
    expect(start?.heading).toBeCloseTo(0);
    expect(end?.heading).toBeCloseTo(Math.PI / 4);
  });

  it("lets a ship that reached its last tile land, and others go under", () => {
    const motion = new ShipMotion();
    motion.tick(at(1, 15, { arriving: false }), map, 10, 0);
    motion.tick(at(2, 16, { arriving: true }), map, 10, 100);
    motion.tick({ ...at(3, 16), boats: [] }, map, 10, 200);
    const [landing] = motion.marks(1, 800, color);
    expect(landing).toMatchObject({ id: 1, state: "landing", speed: 0 });
    expect(landing?.progress).toBeCloseTo(600 / 1400);
    expect(motion.busy(800)).toBe(true);
    expect(motion.busy(200 + 1400)).toBe(false);
    expect(motion.marks(1, 2000, color)).toEqual([]);

    const sunk = new ShipMotion();
    sunk.tick(at(1, 15), map, 10, 0);
    sunk.tick({ ...at(2, 16), boats: [] }, map, 10, 100);
    expect(sunk.marks(1, 100, color)[0]).toMatchObject({ state: "sinking", progress: 0 });
  });

  it("does not sink ships on a jump in time, and never shows a missile as a wreck", () => {
    const motion = new ShipMotion();
    motion.tick(at(1, 15), map, 10, 0);
    motion.tick({ ...at(500, 16), boats: [] }, map, 10, 100);
    expect(motion.marks(1, 100, color)).toEqual([]);
    motion.tick({ ...sea, tick: 501 }, map, 10, 200);
    motion.tick({ ...sea, tick: 502, missiles: [] }, map, 10, 300);
    expect(motion.marks(1, 300, color).some((m) => m.kind === "heavyMissile")).toBe(false);
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
        tracker: {
          firstOrder: (now: number) => firstOrders.push(now),
          used: () => undefined,
        } as never,
      },
    );
    return { orders, sent, firstOrders };
  }
  const playing = {
    phase: "play",
    you: 1,
    players: [{ id: 1, troops: 101, gold: 1, workShare: 0 }],
  } as never;

  it("sends nothing while the game is held or not started", () => {
    for (const { orders, sent } of [setup(undefined), setup(playing, true)]) {
      expect(orders.click(3, "attack", 1)).toBe(false);
      expect(orders.diplomatic("ally", 2)).toBe(false);
      orders.retreat(1);
      orders.quick(2, 0);
      expect(sent).toEqual([]);
    }
  });

  it("keeps sending once the game is won, for a player who plays on (R-WIN-03)", () => {
    const { orders, sent } = setup({ ...(playing as object), winner: 2 });
    orders.retreat(1);
    expect(sent).not.toEqual([]);
  });

  it("lets clicks go out in the spawn phase, but neither diplomacy nor the usage report", () => {
    const { orders, sent, firstOrders } = setup({ phase: "spawn", players: [] });
    expect(orders.click(3, "attack", 1, 2)).toBe(true);
    expect(orders.diplomatic("ally", 2)).toBe(false);
    expect(sent).toEqual([["click", 3, 50, "attack", 1, 2]]);
    expect(firstOrders).toEqual([]);
  });

  it("puts troops to work, and gives soldiers only (R-ECO-07)", () => {
    const busy = {
      phase: "play",
      you: 1,
      players: [{ id: 1, troops: 100, gold: 0, workShare: 40 }],
    } as never;
    const { orders, sent } = setup(busy);
    orders.work(40);
    orders.gift(2, "troops");
    // 60 soldiers, half of them given.
    expect(sent).toEqual([
      { type: "work", share: 40 },
      { type: "gift", target: 2, troops: 30, gold: 0 },
    ]);
    const held = setup(busy, true);
    held.orders.work(10);
    expect(held.sent).toEqual([]);
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
