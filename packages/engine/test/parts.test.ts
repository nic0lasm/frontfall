import { describe, expect, it } from "vitest";
import { SnapshotError, SnapshotReader, SnapshotWriter } from "../src/snapshot-bytes.ts";
import { uint } from "../src/state/codec.ts";
import { PlayerValues, SlotValues, removeWhere } from "../src/state/parts.ts";
import { BUSY } from "./fixtures/busy-game.ts";

/**
 * The parts that rules keep their values in (ADR 0008). A part kept by list
 * slot must follow its list through every push, insert, removal and filter,
 * or a snapshot and the state hash of the game throw.
 */

/** A small generator of its own, so that each run makes the same operations. */
function draws(seed: number): (below: number) => number {
  let state = seed >>> 0;
  return (below) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % below;
  };
}

/** What `part.save` writes, read back from the start. */
function saved(part: { save(out: SnapshotWriter): void }): SnapshotReader {
  const out = new SnapshotWriter();
  part.save(out);
  return new SnapshotReader(out.finish());
}

describe("slot values", () => {
  const game = BUSY.newGame();

  it("follow their list through pushes, inserts, removals and filters", () => {
    const draw = draws(20261107);
    for (let run = 0; run < 300; run++) {
      // The list's entries, and the value the part should hold for each, as a plain array.
      const list: number[] = [];
      const expected: number[] = [];
      const part = new SlotValues(game, () => list, uint);
      for (let step = 0; step < 120; step++) {
        const op = draw(5);
        const entry = draw(1000);
        if (op === 0 || op === 1) {
          list.push(entry);
          expected.push(entry * 3);
          part.push(entry * 3);
        } else if (op === 2) {
          const at = draw(list.length + 1);
          list.splice(at, 0, entry);
          expected.splice(at, 0, entry * 3);
          part.insert(at, entry * 3);
        } else if (op === 3 && list.length > 0) {
          const at = draw(list.length);
          list.splice(at, 1);
          expected.splice(at, 1);
          part.remove(at);
        } else if (op === 4) {
          const out = draw(4);
          const kept = expected.filter((_, slot) => (list[slot] as number) % 4 !== out);
          removeWhere(
            list,
            (item, slot) => {
              // The slot `drop` is given still holds the entry's value.
              expect(part.get(slot)).toBe(expected[slot]);
              return item % 4 === out;
            },
            part,
          );
          expected.splice(0, expected.length, ...kept);
        }
        expect(part.length).toBe(list.length);
      }
      expect(Array.from({ length: part.length }, (_, slot) => part.get(slot))).toEqual(expected);
    }
  });

  it("grow past their first 16 values and keep each", () => {
    const list: number[] = [];
    const part = new SlotValues(game, () => list, uint);
    for (let i = 0; i < 100; i++) {
      list.unshift(i);
      part.insert(0, i);
    }
    expect(Array.from({ length: part.length }, (_, slot) => part.get(slot))).toEqual(list);
    list.length = 40;
    part.truncate(40);
    expect(part.length).toBe(40);
    expect(() => part.get(40)).toThrow(RangeError);
  });

  it("save and load their values", () => {
    const list = [7, 8, 9];
    const part = new SlotValues(game, () => list, uint);
    for (const value of [70, 80, 90]) part.push(value);
    const loaded = new SlotValues(game, () => list, uint);
    loaded.load(saved(part));
    expect([0, 1, 2].map((slot) => loaded.get(slot))).toEqual([70, 80, 90]);
  });

  it("refuse to save out of step with their list", () => {
    const list = [1, 2];
    const part = new SlotValues(game, () => list, uint);
    part.push(10);
    expect(() => saved(part)).toThrow("a part out of step with its list");
  });

  it("refuse a snapshot whose part has another length than the list", () => {
    const list = [1, 2];
    const part = new SlotValues(game, () => list, uint);
    part.push(10);
    part.push(20);
    const bytes = saved(part);
    const shorter = new SlotValues(game, () => [1], uint);
    expect(() => {
      shorter.load(bytes);
    }).toThrow(SnapshotError);
  });
});

describe("player values", () => {
  it("give every player the empty value until set, and save and load by player id", () => {
    const game = BUSY.newGame();
    const ids = game.players().map((p) => p.id);
    const part = new PlayerValues(game, uint, 5);
    expect(ids.map((id) => part.get(id))).toEqual(ids.map(() => 5));
    expect(part.get(-1)).toBe(5);
    expect(part.get(game.territory.maxPlayers + 1)).toBe(5);
    for (const id of ids) part.set(id, id * 2);
    const loaded = new PlayerValues(game, uint, 5);
    loaded.load(saved(part));
    expect(ids.map((id) => loaded.get(id))).toEqual(ids.map((id) => id * 2));
  });
});
