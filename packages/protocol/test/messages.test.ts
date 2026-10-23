import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "../src/messages.ts";

describe("parseClientMessage", () => {
  it("accepts a valid attack intent", () => {
    const message = { type: "intent", intent: { type: "attack", target: 12, troops: 50 } };
    expect(parseClientMessage(JSON.stringify(message))).toEqual({ ok: true, value: message });
  });

  it("trims player names", () => {
    const result = parseClientMessage(
      JSON.stringify({ type: "join", lobby: "a", name: "  Nico " }),
    );
    expect(result.ok && result.value.type === "join" && result.value.name).toBe("Nico");
  });

  it("rejects malformed JSON without throwing", () => {
    expect(parseClientMessage("{")).toEqual({ ok: false, error: "malformed JSON" });
  });

  it("rejects negative troop counts", () => {
    const raw = JSON.stringify({
      type: "intent",
      intent: { type: "attack", target: 1, troops: -5 },
    });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects unknown message types", () => {
    expect(parseClientMessage(JSON.stringify({ type: "cheat" })).ok).toBe(false);
  });
});

describe("parseServerMessage", () => {
  it("accepts a turn", () => {
    const raw = JSON.stringify({
      type: "turn",
      turn: { tick: 3, intents: [{ player: "p1", intent: { type: "spawn", tile: 4 } }] },
    });
    expect(parseServerMessage(raw).ok).toBe(true);
  });
});
