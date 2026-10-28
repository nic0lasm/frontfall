import { describe, expect, it } from "vitest";
import { CueWatcher } from "../src/audio/cues.ts";
import type { GameUpdate } from "../src/game/game-view.ts";

function update(changes: Record<string, unknown> = {}): GameUpdate {
  return {
    you: 1,
    phase: "play",
    players: [{ id: 1, tiles: 100 }],
    attacks: [],
    structures: [],
    missiles: [],
    diplomacy: { allies: [], teammates: [] },
    ...changes,
  } as unknown as GameUpdate;
}

describe("sound cues", () => {
  it("stays silent on the first update, which only sets the baseline", () => {
    const watcher = new CueWatcher();
    const busy = update({
      attacks: [{ id: 1 }],
      structures: [{ id: 1, player: 1, ready: true }],
      missiles: [{ id: 1, player: 1 }],
      diplomacy: { allies: [{ id: 2 }], teammates: [] },
    });
    expect(watcher.observe(busy)).toEqual([]);
    expect(watcher.observe(busy)).toEqual([]);
  });

  it("marks a new attack, then a conquest once it ends with more land", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    expect(watcher.observe(update({ attacks: [{ id: 7 }] }))).toEqual(["attack"]);
    expect(watcher.observe(update({ attacks: [{ id: 7 }] }))).toEqual([]);
    expect(watcher.observe(update({ players: [{ id: 1, tiles: 160 }] }))).toEqual(["conquest"]);
  });

  it("makes no conquest of an attack that won no land", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    watcher.observe(update({ attacks: [{ id: 7 }] }));
    expect(watcher.observe(update())).toEqual([]);
  });

  it("marks the player's own finished buildings and missiles, not a rival's", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    const next = update({
      structures: [
        { id: 1, player: 1, ready: false },
        { id: 2, player: 2, ready: true },
      ],
      missiles: [{ id: 3, player: 2 }],
    });
    expect(watcher.observe(next)).toEqual([]);
    const done = update({
      structures: [{ id: 1, player: 1, ready: true }],
      missiles: [{ id: 4, player: 1 }],
    });
    expect(watcher.observe(done)).toEqual(["build", "missile"]);
  });

  it("marks a new alliance once", () => {
    const watcher = new CueWatcher();
    watcher.observe(update());
    const allied = update({ diplomacy: { allies: [{ id: 2 }], teammates: [] } });
    expect(watcher.observe(allied)).toEqual(["alliance"]);
    expect(watcher.observe(allied)).toEqual([]);
  });

  it("plays victory or defeat once, teams included", () => {
    const won = new CueWatcher();
    won.observe(update());
    expect(won.observe(update({ winner: 1 }))).toEqual(["victory"]);
    expect(won.observe(update({ winner: 1 }))).toEqual([]);

    const lost = new CueWatcher();
    lost.observe(update());
    expect(lost.observe(update({ winner: 2 }))).toEqual(["defeat"]);

    const team = new CueWatcher();
    team.observe(update());
    const teammate = update({
      winner: 3,
      winningTeam: 0,
      diplomacy: { allies: [], teammates: [3] },
    });
    expect(team.observe(teammate)).toEqual(["victory"]);
  });
});
