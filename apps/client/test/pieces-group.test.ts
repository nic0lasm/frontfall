import { describe, expect, it } from "vitest";
import { groupPieces, keyOf } from "../src/render/pieces-group.ts";

const at = (x: number, y: number, owner = "red") => ({ x, y, owner });

describe("groupPieces", () => {
  it("leaves pieces that are far apart on their own", () => {
    const groups = groupPieces([at(0, 0), at(30, 0), at(0, 30)], 10);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1, 1]);
  });

  it("groups close pieces of one owner, chaining through a middle one", () => {
    const groups = groupPieces([at(0, 0), at(8, 0), at(16, 0), at(80, 80)], 10);
    const sizes = groups.map((g) => g.members.length).sort();
    expect(sizes).toEqual([1, 3]);
  });

  it("never mixes owners", () => {
    const groups = groupPieces([at(0, 0, "red"), at(2, 0, "blue")], 10);
    expect(groups).toHaveLength(2);
  });

  it("counts a vertical gap as a little more than a horizontal one", () => {
    expect(groupPieces([at(0, 0), at(0, 9)], 10)).toHaveLength(2);
    expect(groupPieces([at(0, 0), at(9, 0)], 10)).toHaveLength(1);
  });

  it("lists the piece nearest the centre of a group first", () => {
    const [group] = groupPieces([at(0, 0), at(9, 0), at(18, 0)], 10);
    expect(group?.members[0]).toBe(1);
  });

  it("keeps a pair together a little beyond the reach once it has been together", () => {
    const pair = [at(0, 0), at(10.8, 0)];
    expect(groupPieces(pair, 10)).toHaveLength(2);
    const before = new Map([
      [keyOf(0, 0), 0],
      [keyOf(10.8, 0), 0],
    ]);
    expect(groupPieces(pair, 10, before)).toHaveLength(1);
  });

  it("groups across the cells of its grid", () => {
    const groups = groupPieces([at(11.1, 11.1), at(11.3, 11.3)], 10);
    expect(groups).toHaveLength(1);
  });
});
