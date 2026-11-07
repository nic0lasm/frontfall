import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/game-view.ts";
import { Effects, sameEntries, select, shallowEqual, signal } from "../src/signals.ts";
import { doctrineView } from "../src/ui/doctrine-picker.ts";
import { tradeGains } from "../src/ui/gold-floats.ts";

describe("select", () => {
  it("runs a watcher only when its part of the source changes", () => {
    const source = signal({ tick: 1, gold: 10 });
    const effects = new Effects();
    const golds: number[] = [];
    effects.watch(
      select(source, (value) => value.gold),
      (gold) => golds.push(gold),
    );
    source.value = { tick: 2, gold: 10 };
    source.value = { tick: 3, gold: 12 };
    source.value = { tick: 4, gold: 12 };
    expect(golds).toEqual([10, 12]);
    effects.dispose();
  });

  it("keeps the last pick while `equals` finds the new one the same", () => {
    const source = signal({ tick: 1, phase: "spawn" });
    const picked = select(source, (value) => ({ phase: value.phase }), shallowEqual);
    const first = picked.value;
    source.value = { tick: 2, phase: "spawn" };
    expect(picked.value).toBe(first);
    source.value = { tick: 3, phase: "play" };
    expect(picked.value).toEqual({ phase: "play" });
  });

  it("follows only the source: signals read by the watcher do not run it again", () => {
    const source = signal(1);
    const other = signal(0);
    const effects = new Effects();
    let runs = 0;
    effects.watch(source, () => {
      runs += other.value >= 0 ? 1 : 0;
    });
    other.value = 5;
    expect(runs).toBe(1);
    source.value = 2;
    expect(runs).toBe(2);
    effects.dispose();
  });

  it("stops every watcher of an owner together", () => {
    const source = signal(1);
    const effects = new Effects();
    const seen: number[] = [];
    effects.watch(source, (value) => seen.push(value));
    effects.watch(
      select(source, (value) => value % 2),
      (value) => seen.push(-value),
    );
    effects.dispose();
    source.value = 2;
    expect(seen).toEqual([1, -1]);
  });
});

describe("equality of slices", () => {
  it("compares records by their values and maps by their entries", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameEntries(new Map([[1, "a"]]), new Map([[1, "a"]]))).toBe(true);
    expect(sameEntries(new Map([[1, "a"]]), new Map([[1, "b"]]))).toBe(false);
    expect(sameEntries(new Map([[1, "a"]]), new Map([[2, "a"]]))).toBe(false);
    expect(sameEntries(new Map([[1, "a"]]), new Map())).toBe(false);
  });
});

describe("panel slices", () => {
  const spawn = {
    phase: "spawn",
    doctrines: true,
    spawnTicksLeft: 95,
    you: 1,
    players: [{ id: 1, doctrine: 2 }],
    events: [],
  } as unknown as GameUpdate;

  it("shows the doctrine cards in the spawn phase only, by the second", () => {
    expect(doctrineView(spawn, 10)).toEqual({ open: true, seconds: 10, picked: 2 });
    expect(
      shallowEqual(doctrineView(spawn, 10), doctrineView({ ...spawn, spawnTicksLeft: 91 }, 10)),
    ).toBe(true);
    expect(doctrineView({ ...spawn, phase: "play" }, 10).open).toBe(false);
    expect(doctrineView({ ...spawn, doctrines: false } as unknown as GameUpdate, 10).open).toBe(
      false,
    );
    expect(doctrineView(undefined, 10)).toBe(doctrineView({ ...spawn, phase: "play" }, 10));
  });

  it("lists the gold of the trade ships that docked for the player, the same empty list for none", () => {
    const docked = {
      ...spawn,
      events: [
        { type: "trade", a: 1, tile: 7, gold: 40 },
        { type: "trade", a: 2, tile: 8, gold: 50 },
        { type: "trade", a: 1, tile: 9 },
        { type: "trade", a: 1 },
      ],
    } as unknown as GameUpdate;
    expect(tradeGains(docked)).toEqual([
      { tile: 7, gold: 40 },
      { tile: 9, gold: 0 },
    ]);
    expect(tradeGains(spawn)).toBe(tradeGains(undefined));
  });
});
