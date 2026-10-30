import { describe, expect, it } from "vitest";
import { CueWatcher, type Cue } from "../src/audio/cues.ts";
import type { GameUpdate } from "../src/game/game-view.ts";

function update(changes: Record<string, unknown> = {}): GameUpdate {
  return {
    you: 1,
    phase: "play",
    players: [{ id: 1, tiles: 100 }],
    attacks: [],
    structures: [],
    missiles: [],
    missileEvents: [],
    events: [],
    diplomacy: { allies: [], teammates: [], incoming: [] },
    ...changes,
  } as unknown as GameUpdate;
}

const names = (watcher: CueWatcher, next: GameUpdate): Cue[] =>
  watcher.observe(next).map((event) => event.cue);

describe("sound cues", () => {
  it("stays silent on the first update, which only sets the baseline", () => {
    const watcher = new CueWatcher();
    const busy = update({
      attacks: [{ id: 1 }],
      structures: [{ id: 1, player: 1, ready: true, type: "city", tile: 5 }],
      missiles: [{ id: 1, player: 1, tile: 2, target: 9 }],
      diplomacy: { allies: [{ id: 2 }], teammates: [], incoming: [{ from: 3 }] },
    });
    expect(names(watcher, busy)).toEqual([]);
    expect(names(watcher, busy)).toEqual([]);
  });

  it("marks the start of play once the spawn phase is over", () => {
    const watcher = new CueWatcher();
    watcher.observe(update({ phase: "spawn" }));
    expect(names(watcher, update({ phase: "spawn" }))).toEqual([]);
    expect(names(watcher, update())).toEqual(["start"]);
    expect(names(watcher, update())).toEqual([]);
  });

  it("marks a new attack, then a conquest once it ends with more land", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    expect(names(watcher, update({ attacks: [{ id: 7 }] }))).toEqual(["attack"]);
    expect(names(watcher, update({ attacks: [{ id: 7 }] }))).toEqual([]);
    expect(names(watcher, update({ players: [{ id: 1, tiles: 110 }] }))).toEqual(["conquest"]);
  });

  it("calls a conquest grand when it wins a lot of land", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    watcher.observe(update({ attacks: [{ id: 7 }] }));
    expect(names(watcher, update({ players: [{ id: 1, tiles: 220 }] }))).toEqual(["grand"]);
  });

  it("makes no conquest of an attack that won no land", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    watcher.observe(update({ attacks: [{ id: 7 }] }));
    expect(names(watcher, update())).toEqual([]);
  });

  it("raises the alarm when land is lost, not for a few tiles", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    expect(names(watcher, update({ players: [{ id: 1, tiles: 99 }] }))).toEqual([]);
    expect(names(watcher, update({ players: [{ id: 1, tiles: 80 }] }))).toEqual(["alert"]);
  });

  it("names the player's own finished structures, with their place, not a rival's", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    const next = update({
      structures: [
        { id: 1, player: 1, ready: false, type: "fort", tile: 4 },
        { id: 2, player: 2, ready: true, type: "city", tile: 5 },
      ],
    });
    expect(names(watcher, next)).toEqual([]);
    const done = update({
      structures: [
        { id: 1, player: 1, ready: true, type: "fort", tile: 4 },
        { id: 4, player: 1, ready: true, type: "airDefense", tile: 6 },
      ],
    });
    expect(watcher.observe(done)).toEqual([
      { cue: "fort", own: true, tile: 4 },
      { cue: "defense", own: true, tile: 6 },
    ]);
  });

  it("hears a missile leave and land, a rival's too", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    const flying = update({
      missiles: [
        { id: 3, player: 1, tile: 10, target: 99 },
        { id: 4, player: 2, tile: 20, target: 77 },
      ],
    });
    expect(watcher.observe(flying)).toEqual([{ cue: "missile", own: true, tile: 10 }]);
    const down = update({
      missileEvents: [
        { type: "struck", id: 3, player: 1, tile: 99 },
        { type: "struck", id: 4, player: 2, tile: 77 },
      ],
    });
    expect(watcher.observe(down)).toEqual([
      { cue: "impact", own: true, tile: 99 },
      { cue: "impact", own: false, tile: 77 },
    ]);
  });

  it("does not hear an impact for a missile stopped in the air", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    watcher.observe(update({ missiles: [{ id: 3, player: 2, tile: 20, target: 77 }] }));
    const stopped = update({
      missileEvents: [{ type: "intercepted", id: 3, player: 2, tile: 40 }],
    });
    expect(watcher.observe(stopped)).toEqual([]);
  });

  it("marks a new alliance and a new request once each", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    const allied = update({
      diplomacy: { allies: [{ id: 2 }], teammates: [], incoming: [{ from: 3 }] },
    });
    expect(names(watcher, allied)).toEqual(["alliance", "request"]);
    expect(names(watcher, allied)).toEqual([]);
  });

  it("marks a betrayal by an ally, not one of someone else's", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    expect(names(watcher, update({ events: [{ type: "betrayed", a: 2, b: 3 }] }))).toEqual([]);
    expect(names(watcher, update({ events: [{ type: "betrayed", a: 2, b: 1 }] }))).toEqual([
      "betrayal",
    ]);
  });

  it("plays victory or defeat once, teams included", () => {
    const won = new CueWatcher();
    won.observe(update());
    expect(names(won, update({ winner: 1 }))).toEqual(["victory"]);
    expect(names(won, update({ winner: 1 }))).toEqual([]);

    const lost = new CueWatcher();
    lost.observe(update());
    expect(names(lost, update({ winner: 2 }))).toEqual(["defeat"]);

    const team = new CueWatcher();
    team.observe(update());
    const teammate = update({
      winner: 3,
      winningTeam: 0,
      diplomacy: { allies: [], teammates: [3], incoming: [] },
    });
    expect(names(team, teammate)).toEqual(["victory"]);
  });
});
