import { describe, expect, it } from "vitest";
import type { GameUpdate } from "../src/game/game-runner.ts";
import { StatsRecorder } from "../src/ui/screen/stats-history.ts";

function update(tick: number, tiles: [number, number], events: GameUpdate["events"] = []) {
  return {
    you: 1,
    tick,
    phase: "play",
    events,
    players: [
      { id: 1, name: "Ana", troops: 10.7, tiles: tiles[0], alive: tiles[0] > 0 },
      { id: 2, name: "Bot", troops: 5, tiles: tiles[1], alive: tiles[1] > 0 },
    ],
  } as unknown as GameUpdate;
}

describe("the end screen's history", () => {
  it("samples every five seconds of game time, whatever the pace of updates", () => {
    const recorder = new StatsRecorder(10);
    for (let tick = 0; tick <= 120; tick += 3) recorder.observe(update(tick, [tick, 1]));
    const history = recorder.finish(update(120, [120, 1]));
    expect(history.ticks).toEqual([0, 51, 102, 120]);
    expect(history.tiles[1]?.[1]).toBe(51);
    expect(history.troops[0]?.[1]).toBe(10);
    expect(history.names[2]).toBe("Bot");
  });

  it("closes the record with the last update", () => {
    const recorder = new StatsRecorder(10);
    recorder.observe(update(0, [1, 1]));
    recorder.observe(update(10, [2, 1]));
    expect(recorder.finish(update(10, [2, 1])).ticks).toEqual([0, 10]);
  });

  it("marks the player's alliances and betrayals, and every elimination, once", () => {
    const recorder = new StatsRecorder(10);
    recorder.observe(update(0, [5, 5]));
    recorder.observe(
      update(
        20,
        [5, 5],
        [
          { type: "allied", a: 1, b: 2 },
          { type: "allied", a: 2, b: 3 },
        ],
      ),
    );
    recorder.observe(update(30, [5, 0]));
    recorder.observe(update(40, [5, 0]));
    const { marks } = recorder.finish(update(40, [5, 0]));
    expect(marks).toEqual([
      { tick: 20, kind: "allied", a: 1, b: 2 },
      { tick: 30, kind: "out", a: 2, b: 0 },
    ]);
  });
});
