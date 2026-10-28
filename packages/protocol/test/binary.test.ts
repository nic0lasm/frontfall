import { describe, expect, it } from "vitest";
import {
  ByteReader,
  ByteWriter,
  DecodeError,
  FrameKind,
  decodeFrame,
  encodeOrderFrame,
  encodeTurnBody,
  encodeTurnsFrame,
} from "../src/binary.ts";
import { PROTOCOL_VERSION } from "../src/messages.ts";
import { ORDER_KINDS } from "../src/orders.ts";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("varint", () => {
  it.each([0, 1, 127, 128, 300, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER])(
    "round-trips %d",
    (value) => {
      const reader = new ByteReader(new ByteWriter().varint(value).finish());
      expect(reader.varint()).toBe(value);
      reader.end();
    },
  );

  it("uses one byte below 128 and two up to 16383", () => {
    expect(new ByteWriter().varint(127).finish()).toEqual(bytes(127));
    expect(new ByteWriter().varint(16_383).finish()).toEqual(bytes(0xff, 0x7f));
  });

  it("refuses values it cannot represent", () => {
    expect(() => new ByteWriter().varint(-1)).toThrow(RangeError);
    expect(() => new ByteWriter().varint(1.5)).toThrow(RangeError);
    expect(() => new ByteWriter().varint(2 ** 53)).toThrow(RangeError);
  });

  it("rejects truncated, padded and oversized values", () => {
    expect(() => new ByteReader(bytes(0x80)).varint()).toThrow(DecodeError);
    expect(() => new ByteReader(bytes(0x81, 0x00)).varint()).toThrow("minimally");
    expect(() => new ByteReader(bytes(...Array<number>(8).fill(0xff), 1)).varint()).toThrow(
      "too large",
    );
    expect(() =>
      new ByteReader(bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f)).varint(),
    ).toThrow("too large");
  });

  it("grows its buffer for long frames", () => {
    const writer = new ByteWriter();
    for (let index = 0; index < 1000; index++) writer.varint(2 ** 40);
    expect(writer.finish().length).toBe(6000);
  });
});

describe("frames", () => {
  it("makes a busy turn at least three times smaller than JSON", () => {
    const orders = Array.from({ length: 32 }, (_, index) => ({
      player: (index % 16) + 1,
      order: { type: "attack" as const, target: 1_500_000 + index * 997, troops: 25_000 + index },
    }));
    const turn = { tick: 36_000, orders };
    const json = JSON.stringify({ type: "turns", turns: [turn] });
    const frame = encodeTurnsFrame(turn.tick, [encodeTurnBody(turn.orders)]);
    // The JSON is ASCII: one byte per character.
    expect(frame.byteLength * 3).toBeLessThanOrEqual(json.length);
  });

  it("decodes an order frame", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "attack", target: 5, troops: 6 }))).toEqual({
      kind: "order",
      order: { type: "attack", target: 5, troops: 6 },
    });
  });

  it("carries a retreat with its attack id", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "retreat", attack: 3 }))).toEqual({
      kind: "order",
      order: { type: "retreat", attack: 3 },
    });
  });

  it("carries a ship's landing tile and troops", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "embark", target: 70_000, troops: 900 }))).toEqual({
      kind: "order",
      order: { type: "embark", target: 70_000, troops: 900 },
    });
  });

  it("carries a build with its structure code and tile", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "build", structure: 1, tile: 70_000 }))).toEqual({
      kind: "order",
      order: { type: "build", structure: 1, tile: 70_000 },
    });
  });

  it("carries a demolition's tile", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "demolish", tile: 5 }))).toEqual({
      kind: "order",
      order: { type: "demolish", tile: 5 },
    });
  });

  it("carries a gift's troops and gold, either of them 0", () => {
    const order = { type: "gift" as const, target: 7, troops: 0, gold: 2 ** 40 + 3 };
    expect(decodeFrame(encodeOrderFrame(order))).toEqual({ kind: "order", order });
  });

  it("carries a quick message's target and number", () => {
    const order = { type: "quick" as const, target: 3, phrase: 11 };
    expect(decodeFrame(encodeOrderFrame(order))).toEqual({ kind: "order", order });
  });

  it("carries alliance requests and betrayals with their target player", () => {
    for (const type of ["ally", "betray"] as const) {
      expect(decodeFrame(encodeOrderFrame({ type, target: 0xffff }))).toEqual({
        kind: "order",
        order: { type, target: 0xffff },
      });
    }
  });

  it("numbers decoded turns from the first tick", () => {
    const frame = encodeTurnsFrame(41, [
      encodeTurnBody([]),
      encodeTurnBody([{ player: 3, order: { type: "spawn", tile: 2 } }]),
    ]);
    expect(decodeFrame(frame)).toEqual({
      kind: "turns",
      turns: [
        { tick: 41, orders: [] },
        { tick: 42, orders: [{ player: 3, order: { type: "spawn", tile: 2 } }] },
      ],
    });
  });

  it("rejects unknown frames and orders", () => {
    expect(() => decodeFrame(bytes())).toThrow("ends early");
    expect(() => decodeFrame(bytes(9))).toThrow("unknown frame kind");
    expect(() => decodeFrame(bytes(FrameKind.order, 99))).toThrow("unknown order type");
  });

  it("validates decoded values", () => {
    // Attack with zero troops.
    expect(() => decodeFrame(bytes(FrameKind.order, 1, 5, 0))).toThrow(DecodeError);
    // Player number zero.
    expect(() => decodeFrame(bytes(FrameKind.turns, 0, 1, 1, 0, 0, 5))).toThrow(DecodeError);
    // Tile beyond 2^31 - 1.
    expect(() =>
      decodeFrame(
        new ByteWriter()
          .byte(FrameKind.order)
          .varint(0)
          .varint(2 ** 31)
          .finish(),
      ),
    ).toThrow(DecodeError);
  });

  it("rejects trailing bytes", () => {
    const frame = encodeOrderFrame({ type: "spawn", tile: 1 });
    expect(() => decodeFrame(bytes(...frame, 0))).toThrow("unexpected bytes");
  });

  it("rejects counts larger than the frame could hold before allocating", () => {
    const frame = new ByteWriter().byte(FrameKind.turns).varint(0).varint(1_000_000_000).finish();
    expect(() => decodeFrame(frame)).toThrow("count exceeds the frame");
  });

  it("refuses to encode unknown orders", () => {
    expect(() => encodeOrderFrame({ type: "launch" } as never)).toThrow(RangeError);
  });
});

describe("order kinds", () => {
  // A page loaded before a deployment cannot read an order kind it does not
  // know. Adding one must bump PROTOCOL_VERSION, so that page is turned away
  // at `hello` instead of skipping turns: update both lines together.
  it("are pinned to the protocol version", () => {
    expect({
      version: PROTOCOL_VERSION,
      kinds: ORDER_KINDS.map((kind) => kind.type),
    }).toEqual({
      version: 22,
      kinds: [
        "spawn",
        "attack",
        "retreat",
        "embark",
        "build",
        "demolish",
        "ally",
        "betray",
        "embargo",
        "warship",
        "patrol",
        "missile",
        "gift",
        "quick",
        "work",
      ],
    });
  });
});
