import { afterEach, describe, expect, it } from "vitest";
import type { LabelAnchor } from "../src/game/label-anchors.ts";
import type { PlayerView } from "../src/game/solo-game.ts";
import type { Camera } from "../src/render/camera.ts";
import { PlayerLabels } from "../src/ui/labels.ts";

/** Just enough of a DOM element for the labels, counting what the page would be asked to do. */
class FakeElement {
  static created = 0;
  static styleWrites = 0;
  hidden = false;
  textContent = "";
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  private readonly css = new Map<string, string>();
  readonly style = new Proxy(
    {},
    {
      set: (_target, key, value: string) => {
        FakeElement.styleWrites++;
        this.css.set(String(key), value);
        return true;
      },
      get: (_target, key) => this.css.get(String(key)),
    },
  );
  constructor() {
    FakeElement.created++;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") this.textContent += node;
      else this.children.push(node);
    }
  }
  querySelector(): FakeElement | undefined {
    return this.children[0];
  }
}

const realDocument = (globalThis as { document?: unknown }).document;
function fakeDocument(): void {
  FakeElement.created = 0;
  FakeElement.styleWrites = 0;
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
}
afterEach(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

const camera = {
  viewportWidth: 1280,
  viewportHeight: 800,
  tileToScreen: (tile: number) => ({ x: (tile % 100) * 12, y: Math.floor(tile / 100) * 12 }),
} as unknown as Camera;

function player(id: number): PlayerView {
  return { id, name: `P${String(id)}`, troops: id * 10, cityState: true } as unknown as PlayerView;
}

describe("player labels", () => {
  it("builds the element of a land big enough for a name and no other (a performance guard)", () => {
    fakeDocument();
    const labels = new PlayerLabels();
    // The nations, then hundreds of city-states: a few pixels across at world scale.
    const players = Array.from({ length: 500 }, (_, i) => player(i + 1));
    const anchors: LabelAnchor[] = players.map((p, i) => ({
      player: p.id,
      tile: i * 3,
      depth: i < 20 ? 40 : 1,
    }));
    labels.update(players, anchors);
    expect(FakeElement.created).toBe(1);
    labels.place(camera, 1);
    // At most the 20 big lands get an element (root and two spans each).
    expect(FakeElement.created).toBeLessThanOrEqual(1 + 20 * 3);
  });

  it("writes no style again when nothing moved", () => {
    fakeDocument();
    const labels = new PlayerLabels();
    const players = [player(1), player(2)];
    labels.update(players, [
      { player: 1, tile: 505, depth: 40 },
      { player: 2, tile: 1010, depth: 40 },
    ]);
    labels.place(camera, 1);
    const writes = FakeElement.styleWrites;
    expect(writes).toBeGreaterThan(0);
    for (let frame = 0; frame < 10; frame++) labels.place(camera, 1);
    expect(FakeElement.styleWrites).toBe(writes);
  });

  it("marks the leader and an ally by rewriting a troops text only when the marks change", () => {
    fakeDocument();
    const labels = new PlayerLabels();
    const players = [
      { ...player(1), alive: true, tiles: 30 },
      { ...player(2), alive: true, tiles: 90 },
    ] as unknown as PlayerView[];
    labels.update(players, [
      { player: 1, tile: 505, depth: 40 },
      { player: 2, tile: 1010, depth: 40 },
    ]);
    labels.place(camera, 1);
    const diplomacy = (allies: number[]) => ({
      allies: allies.map((id) => ({ id })),
      traitors: [],
      embargoes: [],
      embargoedBy: [],
      incoming: [],
      outgoing: [],
    });
    const relations = (allies: number[]): never =>
      ({ phase: "play", players, diplomacy: diplomacy(allies) }) as never;
    labels.setRelations(relations([1]));
    const texts = (): string[] =>
      [...(labels as unknown as { labels: Map<number, { count: string }> }).labels.values()].map(
        (label) => label.count,
      );
    expect(texts()[0]).toMatch(/^\u2713 /);
    expect(texts()[1]).toMatch(/^\u265B /);
    const writes = FakeElement.styleWrites;
    labels.setRelations(relations([1]));
    expect(texts()[0]).toMatch(/^\u2713 /);
    labels.setRelations(relations([]));
    expect(texts()[0]).toBe("10");
    expect(FakeElement.styleWrites).toBe(writes);
  });
});
