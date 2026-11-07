import { parseServerMessage, type Frame } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import {
  MAX_BUFFERED_BYTES,
  peerOutbox,
  RoomOutbox,
  type Link,
  type Peer,
} from "../src/room-outbox.ts";

/** A connection that hands frames to the network only when told, as a slow one. */
class FakeLink implements Link {
  open = true;
  bufferedAmount = 0;
  readonly sent: Frame[] = [];
  terminated = false;
  private readonly waiting: (() => void)[] = [];

  send(frame: Frame, sent?: () => void): void {
    this.sent.push(frame);
    if (sent) this.waiting.push(sent);
  }

  terminate(): void {
    this.terminated = true;
    this.open = false;
  }

  /** Hands the oldest frame waiting to the network. */
  drain(): void {
    this.waiting.shift()?.();
  }

  texts(): string[] {
    return this.sent.map((frame) => (typeof frame === "string" ? frame : `<${String(frame[1])}>`));
  }
}

const quiet = { slow: () => undefined, probe: () => undefined };

function bytes(n: number): Uint8Array {
  return Uint8Array.of(0, n);
}

describe("the outbox of a peer", () => {
  it("sends a catch-up one frame at a time and holds the other messages until its end", () => {
    const link = new FakeLink();
    const peer = peerOutbox(link, quiet);
    peer.replay?.([bytes(1), bytes(2)], "desync");
    expect(link.texts()).toEqual(["<1>"]);
    peer.send("lobby");
    // A live turn is covered by the catch-up, which runs to the end of the log.
    peer.send(bytes(9));
    link.drain();
    expect(link.texts()).toEqual(["<1>", "<2>"]);
    link.drain();
    expect(link.texts()).toEqual(["<1>", "<2>", "desync", "lobby"]);
    peer.send(bytes(3));
    expect(link.texts().at(-1)).toBe("<3>");
  });

  it("stops a catch-up once the connection closes", () => {
    const link = new FakeLink();
    const peer = peerOutbox(link, quiet);
    peer.replay?.([bytes(1), bytes(2)]);
    link.open = false;
    link.drain();
    expect(link.texts()).toEqual(["<1>"]);
    peer.send("late");
    expect(link.texts()).toEqual(["<1>"]);
  });

  it("cuts a client that leaves more than 4 MiB unread", () => {
    const link = new FakeLink();
    let slow = 0;
    const peer = peerOutbox(link, { ...quiet, slow: () => slow++ });
    link.bufferedAmount = MAX_BUFFERED_BYTES;
    peer.send("still");
    expect(link.terminated).toBe(false);
    link.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    peer.send("cut");
    expect(link.terminated).toBe(true);
    expect(slow).toBe(1);
    expect(link.texts()).toEqual(["still"]);
  });

  it("passes a probe on", () => {
    let probes = 0;
    peerOutbox(new FakeLink(), { ...quiet, probe: () => probes++ }).probe();
    expect(probes).toBe(1);
  });
});

class Inbox implements Peer {
  readonly frames: Frame[] = [];

  send(frame: Frame): void {
    this.frames.push(frame);
  }

  probe(): void {
    // Not asked here.
  }
}

describe("the outbox of a room", () => {
  it("encodes once for every seat, and skips the seats without a peer", () => {
    const a = new Inbox();
    const b = new Inbox();
    const away = { peer: undefined };
    const outbox = new RoomOutbox([{ peer: a }, away, { peer: b }]);
    outbox.toEverySeat({ type: "ended", reason: "timeout" });
    expect(a.frames).toEqual(['{"type":"ended","reason":"timeout"}']);
    expect(b.frames).toEqual(a.frames);
    outbox.toSeat(away, { type: "ended", reason: "removed" });
    outbox.turns(4, [Uint8Array.of(0)]);
    expect(a.frames).toHaveLength(2);
    const turns = parseServerMessage(a.frames[1] ?? "");
    expect(turns.ok && turns.value).toMatchObject({ type: "turns", turns: [{ tick: 4 }] });
  });

  it("sends a catch-up at once to a peer that does not pace it", () => {
    const peer = new Inbox();
    new RoomOutbox([]).catchUp({ peer }, [bytes(1)], {
      type: "desync",
      tick: 0,
      hash: 1,
      expected: 2,
    });
    expect(peer.frames).toHaveLength(2);
    expect(peer.frames[1]).toBe('{"type":"desync","tick":0,"hash":1,"expected":2}');
  });
});
