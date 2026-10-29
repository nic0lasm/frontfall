import { describe, expect, it } from "vitest";
import { advance, type GuideState } from "../src/ui/guide.ts";
import { guideDone, setGuideDone } from "../src/ui/guide-state.ts";

const spawn: GuideState = {
  phase: "spawn",
  tiles: 0,
  tilesAtPlay: 0,
  cities: 0,
  forts: 0,
  ratioMoved: false,
  playerMenu: false,
};

describe("advance", () => {
  it("waits on each step until the player does it", () => {
    expect(advance("start", spawn)).toBe("start");
    const started = { ...spawn, tiles: 20 };
    expect(advance("start", started)).toBe("expand");
    // Growing during the spawn phase is not expanding.
    expect(advance("expand", { ...started, tiles: 25 })).toBe("expand");
    const playing = { ...started, phase: "play" as const, tilesAtPlay: 20 };
    expect(advance("expand", playing)).toBe("expand");
    const grown = { ...playing, tiles: 30 };
    expect(advance("expand", grown)).toBe("troops");
    // The slider is the one thing the player may leave: Next, or a building, moves on.
    expect(advance("troops", grown)).toBe("troops");
    expect(advance("troops", { ...grown, ratioMoved: true })).toBe("build");
    expect(advance("build", { ...grown, ratioMoved: true })).toBe("build");
    expect(advance("build", { ...grown, cities: 1 })).toBe("defend");
    expect(advance("defend", { ...grown, cities: 1 })).toBe("defend");
    expect(advance("defend", { ...grown, cities: 1, forts: 1 })).toBe("players");
    expect(advance("players", { ...playing, playerMenu: true })).toBe("done");
    expect(advance("done", { ...playing, playerMenu: true })).toBe("done");
  });

  it("skips steps the player already did", () => {
    const ahead = {
      phase: "play",
      tiles: 40,
      tilesAtPlay: 20,
      cities: 1,
      forts: 1,
      ratioMoved: false,
      playerMenu: false,
    } as const;
    expect(advance("start", ahead)).toBe("players");
  });
});

describe("guide storage", () => {
  it("remembers the guide is done, and forgets it to show it again", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    expect(guideDone(storage)).toBe(false);
    setGuideDone(storage, true);
    expect(guideDone(storage)).toBe(true);
    setGuideDone(storage, false);
    expect(guideDone(storage)).toBe(false);
  });

  it("works without storage, or with storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(guideDone(undefined)).toBe(false);
    expect(guideDone(broken)).toBe(false);
    expect(() => {
      setGuideDone(broken, true);
    }).not.toThrow();
  });
});

describe("play hint storage", () => {
  it("is remembered once seen, and survives storage that throws", async () => {
    const { hintSeen, setHintSeen } = await import("../src/ui/hint-state.ts");
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;
    expect(hintSeen(storage)).toBe(false);
    setHintSeen(storage);
    expect(hintSeen(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(hintSeen(undefined)).toBe(false);
    expect(hintSeen(broken)).toBe(false);
    expect(() => {
      setHintSeen(broken);
    }).not.toThrow();
  });
});
