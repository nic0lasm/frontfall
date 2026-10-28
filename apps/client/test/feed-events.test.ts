import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/solo-game.ts";
import { FeedWatcher, landLost } from "../src/ui/feed-events.ts";
import { facts, relation } from "../src/ui/player-tip.ts";

function update(patch: Partial<GameUpdate> = {}): GameUpdate {
  return {
    you: 1,
    tick: 100,
    players: [
      { id: 1, name: "Ada", troops: 500, cap: 900, gold: 1200, tiles: 50, alive: true },
      { id: 2, name: "Bo", troops: 80, cap: 200, gold: 10, tiles: 20, alive: true },
      { id: 3, name: "Cy", troops: 30, cap: 100, gold: 5, tiles: 10, alive: true },
    ],
    structures: [],
    events: [],
    changedTiles: new Int32Array(0),
    changedOwners: new Uint16Array(0),
    diplomacy: {
      allies: [],
      teammates: [],
      incoming: [],
      outgoing: [],
      waiting: [],
      traitors: [],
      embargoes: [],
      embargoedBy: [],
      atWar: [],
      quickIn: 0,
    },
    ...patch,
  } as unknown as GameUpdate;
}

const mine = () => 1;

describe("landLost", () => {
  it("names who took the player's land, and the first tile of it", () => {
    const owners = [1, 1, 1, 3, 0];
    const lost = landLost(
      update({
        changedTiles: Int32Array.of(1, 2, 3, 4, 0),
        changedOwners: Uint16Array.of(2, 2, 1, 1, 0),
      }),
      (tile) => owners[tile] as number,
    );
    // Tile 3 was Cy's, 4 unclaimed, 0 went to nobody: only tiles 1 and 2 were the player's.
    expect([...lost]).toEqual([[2, 1]]);
  });
});

describe("FeedWatcher", () => {
  it("says nothing about what was already there at the first update", () => {
    const watcher = new FeedWatcher(true);
    const first = update({
      diplomacy: { ...update().diplomacy, incoming: [{ from: 2, ticksLeft: 100 }] },
    });
    expect(watcher.observe(first, new Map(), mine)).toEqual([]);
  });

  it("reports a new alliance request once, with the player to centre on", () => {
    const watcher = new FeedWatcher(true);
    watcher.observe(update(), new Map(), mine);
    const asking = update({
      diplomacy: { ...update().diplomacy, incoming: [{ from: 2, ticksLeft: 100 }] },
    });
    const [entry] = watcher.observe(asking, new Map(), mine);
    expect(entry).toMatchObject({ key: "request:2", tone: "ask", player: 2, mine: true });
    expect(entry?.text).toContain("Bo");
    expect(watcher.observe(asking, new Map(), mine)).toEqual([]);
  });

  it("reports land taken once per quiet period, at the tile it was taken", () => {
    const watcher = new FeedWatcher(true);
    watcher.observe(update(), new Map(), mine);
    const lost = new Map([[2, 42]]);
    const [entry] = watcher.observe(update({ tick: 110 }), lost, mine);
    expect(entry).toMatchObject({ key: "attacked:2", tone: "bad", tile: 42, player: 2 });
    expect(watcher.observe(update({ tick: 120 }), lost, mine)).toEqual([]);
    expect(watcher.observe(update({ tick: 400 }), lost, mine)).toHaveLength(1);
  });

  it("reports a building lost only when its land went to someone else", () => {
    const watcher = new FeedWatcher(true);
    const city = { id: 7, player: 1, type: "city", tile: 9, ready: true };
    const fort = { id: 8, player: 1, type: "fort", tile: 10, ready: true };
    watcher.observe(update({ structures: [city, fort] as never }), new Map(), mine);
    // The city is gone and its land is another player's; the fort was demolished on the player's own land.
    const entries = watcher.observe(update(), new Map(), (tile) => (tile === 9 ? 2 : 1));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: "lost:city", tone: "bad", tile: 9 });
  });

  it("turns the engine's events into entries, good or bad for the player", () => {
    const watcher = new FeedWatcher(true);
    watcher.observe(update(), new Map(), mine);
    const entries = watcher.observe(
      update({
        events: [
          { type: "betrayed", a: 2, b: 1 },
          { type: "allied", a: 1, b: 3 },
          { type: "embargo", a: 2, b: 3 },
          { type: "quick", a: 2, b: 3, phrase: 0 },
        ],
      }),
      new Map(),
      mine,
    );
    // A quick message between two others is not for the player to read (R-DIPLO-07).
    expect(entries.map((e) => [e.tone, e.mine, e.player])).toEqual([
      ["bad", true, 2],
      ["good", true, 3],
      ["info", false, 2],
    ]);
  });

  it("keeps who is allied with whom from the events", () => {
    const watcher = new FeedWatcher(false);
    watcher.observe(update({ events: [{ type: "allied", a: 2, b: 3 }] }), new Map(), mine);
    expect(watcher.alliesOf(3)).toEqual([2]);
    watcher.observe(update({ events: [{ type: "betrayed", a: 3, b: 2 }] }), new Map(), mine);
    expect(watcher.alliesOf(3)).toEqual([]);
  });

  it("reports nothing of the player's own in a replay", () => {
    const watcher = new FeedWatcher(false);
    watcher.observe(update(), new Map(), mine);
    const [entry] = watcher.observe(
      update({ events: [{ type: "betrayed", a: 2, b: 1 }] }),
      new Map([[2, 5]]),
      mine,
    );
    expect(entry).toMatchObject({ tone: "info", mine: false });
  });
});

describe("player card", () => {
  const rules = { ticksPerSecond: 10, firstNation: 3, teams: [], ownableTiles: 1000 };

  it("tells how the player stands with you", () => {
    const base = update();
    expect(relation(base, 1, rules)).toBe("You");
    expect(relation(base, 2, rules)).toBe("Not allied with you");
    expect(relation(base, 3, rules)).toBe("A nation: no alliances");
    const allied = update({
      diplomacy: {
        ...base.diplomacy,
        allies: [{ id: 2, ticksLeft: 250, renewable: false, renewing: false }],
        traitors: [{ id: 2, ticksLeft: 50 }],
        embargoes: [2],
      },
    });
    expect(relation(allied, 2, rules)).toBe(
      "Your ally · 25 s left · Traitor · 5 s · Under your embargo",
    );
  });

  it("gives troops out of their cap, gold and the share of the map", () => {
    expect(facts(update(), 2, rules)).toBe("80 / 200 troops · 10 gold · 2% of the map");
  });
});

describe("collapsed fronts (R-ATTACK-10)", () => {
  const collapsed = (a: number, b: number, tick = 100) =>
    update({ tick, events: [{ type: "collapsed", a, b, tile: 77 }] });

  it("tells the attacker with good news and the defender with a warning, at the tip", () => {
    const watcher = new FeedWatcher(true);
    const [won] = watcher.observe(collapsed(1, 2), new Map(), mine);
    expect(won).toMatchObject({ tone: "good", text: "Bo's front gave way", tile: 77, mine: true });
    const [lost] = watcher.observe(collapsed(3, 1, 400), new Map(), mine);
    expect(lost).toMatchObject({ tone: "bad", text: "Your front gave way before Cy", tile: 77 });
  });

  it("leaves other players' collapses out, and in a replay", () => {
    expect(new FeedWatcher(true).observe(collapsed(2, 3), new Map(), mine)).toEqual([]);
    expect(new FeedWatcher(false).observe(collapsed(1, 2), new Map(), mine)).toEqual([]);
  });

  it("tells a pair once every five seconds of game time", () => {
    const watcher = new FeedWatcher(true);
    expect(watcher.observe(collapsed(1, 2, 100), new Map(), mine)).toHaveLength(1);
    expect(watcher.observe(collapsed(1, 2, 120), new Map(), mine)).toEqual([]);
    expect(watcher.observe(collapsed(3, 1, 120), new Map(), mine)).toHaveLength(1);
    expect(watcher.observe(collapsed(1, 2, 160), new Map(), mine)).toHaveLength(1);
  });
});
