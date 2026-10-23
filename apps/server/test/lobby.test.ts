import { describe, expect, it } from "vitest";
import { Lobby } from "../src/lobby.ts";

describe("Lobby", () => {
  it("numbers turns from zero and keeps intents in arrival order", () => {
    const lobby = new Lobby(1);
    const a = lobby.join();
    const b = lobby.join();
    lobby.submit(b, { type: "spawn", tile: 2 });
    lobby.submit(a, { type: "spawn", tile: 1 });

    expect(lobby.closeTurn()).toEqual({
      tick: 0,
      intents: [
        { player: b, intent: { type: "spawn", tile: 2 } },
        { player: a, intent: { type: "spawn", tile: 1 } },
      ],
    });
    expect(lobby.closeTurn()).toEqual({ tick: 1, intents: [] });
  });

  it("ignores intents from players who are not in the lobby", () => {
    const lobby = new Lobby(1);
    const player = lobby.join();
    lobby.leave(player);

    expect(lobby.submit(player, { type: "spawn", tile: 0 })).toBe(false);
    expect(lobby.submit("intruder", { type: "spawn", tile: 0 })).toBe(false);
    expect(lobby.closeTurn().intents).toEqual([]);
    expect(lobby.playerCount).toBe(0);
  });

  it("never reuses a player id", () => {
    const lobby = new Lobby(1);
    const first = lobby.join();
    lobby.leave(first);
    expect(lobby.join()).not.toBe(first);
  });
});
