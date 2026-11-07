import { describe, expect, it } from "vitest";
import type { Attack } from "../src/attacks.ts";
import type { Alliance } from "../src/diplomacy.ts";
import type { TradeShip } from "../src/trade.ts";
import type { Warship } from "../src/warships.ts";
import { MissileSize, type Missile } from "../src/missiles.ts";
import { SnapshotReader, SnapshotWriter } from "../src/snapshot-bytes.ts";
import {
  readInto,
  readRecord,
  uint,
  writeRecord,
  player,
  tile,
  type Codec,
} from "../src/state/codec.ts";
import {
  ALLIANCE_RECORD,
  ATTACK_RECORD,
  MISSILE_RECORD,
  PLAYER_RECORD,
  STRUCTURE_RECORD,
  TRADE_SHIP_RECORD,
  WARSHIP_RECORD,
} from "../src/state/records.ts";
import { StructureKind, type Structure } from "../src/structures.ts";
import { ALL_RULES, BUSY } from "./fixtures/busy-game.ts";

/** The bytes of one record. */
function bytesOf<T>(codec: Codec<T>, record: T, game = BUSY.newGame()): SnapshotReader {
  const out = new SnapshotWriter();
  writeRecord(out, codec, record, game);
  return new SnapshotReader(out.finish());
}

describe("record codecs (ADR 0008)", () => {
  it("name every field of their entity, which the compiler checks", () => {
    const missing = {
      id: uint,
      player,
      target: player,
      aim: tile,
      // @ts-expect-error -- a codec without `troops` misses a field of Attack.
    } satisfies Codec<Attack>;
    const extra = {
      id: uint,
      player,
      target: player,
      aim: tile,
      troops: uint,
      // @ts-expect-error -- Attack has no such field.
      speed: uint,
    } satisfies Codec<Attack>;
    expect(Object.keys(missing)).toHaveLength(4);
    expect(Object.keys(extra)).toHaveLength(6);
  });

  it("read back what they write, leaving out what the snapshot does not carry", () => {
    const game = BUSY.newGame();
    const ship: Warship = {
      id: 3,
      player: 2,
      tile: 41,
      health: 900,
      patrol: 42,
      path: Int32Array.of(42, 43),
      step: 1,
      reloadAt: 9,
      firedAt: 8,
      aim: 44,
    };
    const { firedAt, aim, ...saved } = ship;
    expect([firedAt, aim]).toEqual([8, 44]);
    expect(readRecord(bytesOf(WARSHIP_RECORD, ship, game), WARSHIP_RECORD, game)).toEqual(saved);
    const route = Int32Array.of(30, 31, 32, 112);
    const trade: TradeShip = { id: 1, player: 1, port: 4, from: 29, to: 113, path: route, step: 2 };
    expect(readRecord(bytesOf(TRADE_SHIP_RECORD, trade, game), TRADE_SHIP_RECORD, game)).toEqual(
      trade,
    );
    const missile: Missile = {
      id: 5,
      player: 3,
      size: MissileSize.Heavy,
      from: 7,
      to: 8,
      launchedAt: 10,
      arrivesAt: 20,
      tried: [2, 4],
    };
    expect(readRecord(bytesOf(MISSILE_RECORD, missile, game), MISSILE_RECORD, game)).toEqual(
      missile,
    );
    const alliance: Alliance = { a: 1, b: 2, until: 300, renewA: true, renewB: false };
    expect(readRecord(bytesOf(ALLIANCE_RECORD, alliance, game), ALLIANCE_RECORD, game)).toEqual(
      alliance,
    );
  });

  it("leave a rule's values to its part, which only a game that plays with the rule has", () => {
    const attack: Attack = { id: 1, player: 1, target: 2, aim: 3, troops: 40 };
    const plain = BUSY.newGame();
    const all = ALL_RULES.newGame();
    expect(readRecord(bytesOf(ATTACK_RECORD, attack, plain), ATTACK_RECORD, plain)).toEqual(attack);
    expect(readRecord(bytesOf(ATTACK_RECORD, attack, all), ATTACK_RECORD, all)).toEqual(attack);
    const names = (game: typeof plain) => game.persistedParts().map((p) => p.name);
    const special = ["doctrines", "fronts", "capitals", "capital falls"];
    expect(names(plain).filter((name) => special.includes(name))).toEqual([]);
    expect(names(all).filter((name) => special.includes(name))).toEqual([
      "doctrines",
      "fronts",
      "capitals",
      "capital falls",
    ]);
    const source = all.player(1);
    const target = ALL_RULES.newGame().player(1);
    if (!source || !target) throw new Error("no player");
    source.troops = -5;
    readInto(bytesOf(PLAYER_RECORD, source, all), PLAYER_RECORD, target, all);
    expect([target.troops, target.name]).toEqual([-5, source.name]);
  });

  it("refuse a kind or a size past the last one there is", () => {
    const game = BUSY.newGame();
    const kinds = Object.keys(StructureKind).length;
    const structure: Structure = {
      id: 1,
      player: 1,
      kind: StructureKind.City,
      tile: 0,
      readyAt: 0,
      reloadAt: 0,
    };
    const bad = { ...structure, kind: kinds as StructureKind };
    expect(() => readRecord(bytesOf(STRUCTURE_RECORD, bad, game), STRUCTURE_RECORD, game)).toThrow(
      "structure kind out of range",
    );
    const last = { ...structure, kind: (kinds - 1) as StructureKind };
    expect(readRecord(bytesOf(STRUCTURE_RECORD, last, game), STRUCTURE_RECORD, game)).toEqual(last);
    const missile: Missile = {
      id: 1,
      player: 1,
      size: Object.keys(MissileSize).length as MissileSize,
      from: 0,
      to: 0,
      launchedAt: 0,
      arrivesAt: 1,
      tried: [],
    };
    expect(() => readRecord(bytesOf(MISSILE_RECORD, missile, game), MISSILE_RECORD, game)).toThrow(
      "missile size out of range",
    );
  });
});
