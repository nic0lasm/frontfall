import { parseServerMessage, type Frame, type ServerMessage } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { Room, type Peer, type RoomObserver, type RoomSettings, type Seat } from "../src/room.ts";

const PUBLIC: RoomSettings = {
  visibility: "public",
  name: "Quick game",
  map: "world",
  capacity: 4,
  autoStart: true,
  bots: 0,
  difficulty: "normal",
  nations: true,
  teams: 0,
  disabled: 0,
  speed: 1,
  rules: { collapsingFronts: true },
  minPlayers: 2,
  countdownMs: 10_000,
  hostIdleMs: 120_000,
  soloBots: 0,
  reconnectGraceMs: 60_000,
  lobbyGraceMs: 30_000,
  maxDurationMs: 3_600_000,
  lobbyTimeoutMs: 600_000,
  maxOrdersPerTurn: 3,
  seatsPerAddress: 3,
  maxLogBytes: 1_000_000,
};
/** Started by its host; `autoStart` off so that a full lobby still waits. */
const PRIVATE: RoomSettings = {
  ...PUBLIC,
  visibility: "private",
  name: null,
  autoStart: false,
  minPlayers: 1,
  countdownMs: 0,
};
/** A public game created by its host: no countdown, at least two players. */
const HOSTED: RoomSettings = { ...PUBLIC, name: "Europe 4v4", countdownMs: 0 };

class FakePeer implements Peer {
  readonly inbox: ServerMessage[] = [];
  probes = 0;

  send(frame: Frame): void {
    const parsed = parseServerMessage(frame);
    if (!parsed.ok) throw new Error(parsed.error);
    this.inbox.push(parsed.value);
  }

  probe(): void {
    this.probes++;
  }

  last<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> {
    const found = this.inbox.filter((message) => message.type === type).at(-1);
    if (!found) throw new Error(`no ${type} message`);
    return found as Extract<ServerMessage, { type: T }>;
  }

  turns(): { tick: number; orders: unknown[] }[] {
    return this.inbox.flatMap((message) => (message.type === "turns" ? message.turns : []));
  }
}

function seated(room: Room, name: string, now = 0): { seat: Seat; peer: FakePeer } {
  const peer = new FakePeer();
  const seat = room.join(name, peer, now);
  if (typeof seat === "string") throw new Error(seat);
  return { seat, peer };
}

function events(): RoomObserver & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    started: () => log.push("started"),
    finished: (_room, reason) => log.push(`finished:${reason}`),
    desync: (_room, tick, hash, expected) =>
      log.push(`desync:${String(tick)}:${String(hash)}:${String(expected)}`),
  };
}

describe("public lobby", () => {
  it("waits for the minimum, counts down, then starts with the same seed for all", () => {
    const observer = events();
    const room = new Room("game0000", PUBLIC, 42, observer);
    const alice = seated(room, "Alice", 0);
    expect(room.state).toBe("open");
    expect(alice.peer.last("lobby").startsIn).toBeNull();

    const bob = seated(room, "Bob", 1_000);
    expect(room.state).toBe("starting");
    expect(alice.peer.last("lobby")).toMatchObject({
      players: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      you: 1,
      host: 1,
      startsIn: 10_000,
      holdable: true,
    });
    expect(room.startsIn(6_000)).toBe(5_000);

    room.update(10_999);
    expect(room.state).toBe("starting");
    room.update(11_000);
    expect(room.state).toBe("running");
    expect(observer.log).toEqual(["started"]);
    for (const { peer } of [alice, bob]) {
      expect(peer.last("started")).toMatchObject({ seed: 42, tickRate: 10, bots: 0 });
    }
    expect(bob.peer.last("started").you).toBe(2);
  });

  it("starts at once when the game fills up", () => {
    const room = new Room("game0000", PUBLIC, 1);
    for (const name of ["A", "B", "C", "D"]) seated(room, name);
    expect(room.state).toBe("running");
    expect(room.join("E", new FakePeer(), 0)).toBe("game_started");
  });

  it("refuses players beyond the capacity", () => {
    const room = new Room("game0000", PRIVATE, 1);
    for (const name of ["A", "B", "C", "D"]) seated(room, name);
    expect(room.join("E", new FakePeer(), 0)).toBe("game_full");
  });

  it("stops the countdown when a player leaves below the minimum", () => {
    const room = new Room("game0000", PUBLIC, 1);
    const alice = seated(room, "Alice");
    const bob = seated(room, "Bob");
    expect(room.state).toBe("starting");
    room.leave(bob.seat, 5_000);
    expect(room.state).toBe("open");
    expect(alice.peer.last("lobby")).toMatchObject({ startsIn: null, players: [{ id: 1 }] });
    room.update(20_000);
    expect(room.state).toBe("open");
  });

  it("keeps counting when a player leaves above the minimum", () => {
    const room = new Room("game0000", PUBLIC, 1);
    seated(room, "A", 0);
    seated(room, "B", 0);
    const carol = seated(room, "C", 2_000);
    room.leave(carol.seat, 3_000);
    expect(room.startsIn(3_000)).toBe(7_000);
  });

  it("gives final player numbers in join order at the start", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const a = seated(room, "A");
    const b = seated(room, "B");
    const c = seated(room, "C");
    room.leave(b.seat, 0);
    expect(room.requestStart(a.seat, 0)).toBeUndefined();
    expect(c.peer.last("started")).toMatchObject({
      you: 2,
      players: [
        { id: 1, name: "A" },
        { id: 2, name: "C" },
      ],
    });
  });

  it("numbers players who join under a name already taken", () => {
    const room = new Room("game0000", { ...PRIVATE, capacity: 8 }, 1);
    expect(seated(room, "Commander").seat.name).toBe("Commander");
    expect(seated(room, "commander").seat.name).toBe("commander 2");
    expect(seated(room, "Commander").seat.name).toBe("Commander 3");
    // Still within the longest name, shortened to make room for the number.
    const long = "Abcdefghijklmnopqrst";
    expect(seated(room, long).seat.name).toBe(long);
    expect(seated(room, long).seat.name).toBe("Abcdefghijklmnopqr 2");
  });

  it("finishes when the last player leaves before the start", () => {
    const observer = events();
    const room = new Room("game0000", PUBLIC, 1, observer);
    const alice = seated(room, "Alice");
    room.leave(alice.seat, 0);
    expect(room.state).toBe("finished");
    expect(observer.log).toEqual(["finished:empty"]);
    expect(room.join("Bob", new FakePeer(), 0)).toBe("game_started");
  });
});

describe("lobby timeout", () => {
  it("closes a game that never starts", () => {
    const observer = events();
    const room = new Room("game0000", PRIVATE, 1, observer);
    const host = seated(room, "Host", 1_000);
    room.update(PRIVATE.lobbyTimeoutMs);
    expect(room.state).toBe("open");
    room.update(PRIVATE.lobbyTimeoutMs + 1_000);
    expect(room.state).toBe("finished");
    expect(host.peer.last("ended").reason).toBe("expired");
    expect(observer.log).toEqual(["finished:expired"]);
  });
});

describe("private lobby", () => {
  it("starts only when the host asks", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.update(60_000);
    expect(room.state).toBe("open");
    expect(guest.peer.last("lobby")).toMatchObject({ host: 1, startsIn: null });
    expect(room.requestStart(guest.seat, 0)).toBe("not_host");
    expect(room.requestStart(host.seat, 0)).toBeUndefined();
    expect(room.state).toBe("running");
    expect(room.requestStart(host.seat, 0)).toBe("game_started");
  });

  it("lets the host alone change the game before it starts", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    const options = {
      map: "europe",
      bots: 5,
      difficulty: "easy",
      nations: false,
      teams: 0,
      disabled: 40,
      capacity: 6,
      autoStart: false,
    } as const;
    expect(room.configure(guest.seat, options, 0)).toBe("not_host");
    expect(room.configure(host.seat, options, 0)).toBeUndefined();
    expect(guest.peer.last("lobby")).toMatchObject(options);
    expect(PRIVATE.map).toBe("world");
    room.requestStart(host.seat, 0);
    expect(guest.peer.last("started")).toMatchObject({
      map: "europe",
      bots: 5,
      difficulty: "easy",
      nations: false,
      teams: 0,
      disabled: 40,
    });
    expect(room.configure(host.seat, options, 0)).toBe("game_started");
  });

  it("hands the host role to the next player", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.leave(host.seat, 0);
    expect(guest.peer.last("lobby").host).toBe(2);
    expect(room.requestStart(host.seat, 0)).toBe("not_in_game");
    expect(room.requestStart(guest.seat, 0)).toBeUndefined();
  });

  it("keeps the seat and the host role of a player whose connection drops", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.disconnect(host.seat, 1_000);
    room.update(1_000 + PRIVATE.lobbyGraceMs - 1);
    expect(room.playerCount).toBe(2);

    const back = new FakePeer();
    expect(room.rejoin(host.seat, back, 0, 2_000)).toBeUndefined();
    expect(back.last("lobby")).toMatchObject({ you: 1, host: 1, token: host.seat.token });
    expect(guest.peer.last("lobby").players).toHaveLength(2);
    expect(room.requestStart(host.seat, 2_000)).toBeUndefined();
  });

  it("counts a new connection's settings changes from the start again", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    expect(
      room.configure(
        host.seat,
        {
          map: "world",
          bots: 0,
          difficulty: "hard",
          nations: true,
          teams: 0,
          disabled: 0,
          capacity: 4,
          autoStart: false,
        },
        0,
        5,
      ),
    ).toBeUndefined();
    expect(host.peer.last("lobby").configured).toBe(5);
    room.disconnect(host.seat, 1_000);
    const back = new FakePeer();
    expect(room.rejoin(host.seat, back, 0, 1_500)).toBeUndefined();
    // The page numbers this connection's changes from 1: an old 5 would pass for their answer.
    expect(back.last("lobby").configured).toBe(0);
  });

  it("frees the seat of a player who does not come back in time", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.disconnect(host.seat, 0);
    room.update(PRIVATE.lobbyGraceMs);
    expect(room.playerCount).toBe(1);
    expect(guest.peer.last("lobby").host).toBe(2);
    expect(room.rejoin(host.seat, new FakePeer(), 0, PRIVATE.lobbyGraceMs)).toBe("token_invalid");
  });

  it("frees the seat at once when the page closed its connection", () => {
    const room = new Room("game0000", PRIVATE, 1);
    seated(room, "Host");
    const guest = seated(room, "Guest");
    room.disconnect(guest.seat, 0, true);
    expect(room.playerCount).toBe(1);
  });

  it("starts with an absent player, who rejoins the running game", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.disconnect(guest.seat, 0);
    room.requestStart(host.seat, 100);
    room.update(200);
    const back = new FakePeer();
    expect(room.rejoin(guest.seat, back, 0, 300)).toBeUndefined();
    expect(back.last("started")).toMatchObject({ you: 2, token: guest.seat.token });
    expect(back.turns()).toHaveLength(1);
  });

  it("ends with a restart reason when the server stops", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    room.stop("restart");
    expect(host.peer.last("ended").reason).toBe("restart");
  });
});

describe("public game created by its host (R-MODE-04)", () => {
  it("waits for the host, who needs a second player to start", () => {
    const room = new Room("game0000", HOSTED, 1);
    const host = seated(room, "Host");
    expect(room.requestStart(host.seat, 0)).toBe("not_enough_players");
    const guest = seated(room, "Guest");
    room.update(100_000);
    expect(room.state).toBe("open");
    expect(guest.peer.last("lobby")).toMatchObject({
      name: "Europe 4v4",
      host: 1,
      minPlayers: 2,
      startsIn: null,
      holdable: false,
    });
    expect(room.requestStart(guest.seat, 0)).toBe("not_host");
    expect(room.requestStart(host.seat, 0)).toBeUndefined();
    expect(room.state).toBe("running");
  });

  it("starts once full when the host asked for it, and waits otherwise", () => {
    const auto = new Room("game0000", HOSTED, 1);
    for (const name of ["A", "B", "C", "D"]) seated(auto, name);
    expect(auto.state).toBe("running");

    const manual = new Room("game0001", { ...HOSTED, autoStart: false }, 1);
    for (const name of ["A", "B", "C", "D"]) seated(manual, name);
    expect(manual.state).toBe("open");
    expect(manual.join("E", new FakePeer(), 0)).toBe("game_full");
  });

  it("starts at once when the host lowers the seats to the players present", () => {
    const room = new Room("game0000", HOSTED, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    const options = {
      map: "world",
      bots: 0,
      difficulty: "normal",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 2,
      autoStart: true,
    } as const;
    room.configure(host.seat, options, 0);
    expect(guest.peer.last("started").map).toBe("world");
  });

  it("lets the host rename a public game, never a private one", () => {
    const options = {
      map: "world",
      bots: 0,
      difficulty: "normal",
      nations: true,
      teams: 0,
      disabled: 0,
      capacity: 4,
      autoStart: true,
    } as const;
    const listed = new Room("game0000", HOSTED, 1);
    const host = seated(listed, "Host");
    listed.configure(host.seat, { ...options, name: "Asia only" }, 0);
    expect(host.peer.last("lobby").name).toBe("Asia only");
    const unlisted = new Room("game0001", PRIVATE, 1);
    const owner = seated(unlisted, "Owner");
    unlisted.configure(owner.seat, { ...options, name: "Asia only" }, 0);
    expect(owner.peer.last("lobby").name).toBeNull();
  });
});

describe("removing a player and seats per address (R-MODE-05)", () => {
  function from(room: Room, name: string, address: string) {
    const peer = new FakePeer();
    const seat = room.join(name, peer, 0, address);
    return { seat, peer };
  }

  it("lets the host remove a player, who is told and cannot come back from that address", () => {
    const room = new Room("game0000", HOSTED, 1);
    const host = from(room, "Host", "10.0.0.1");
    const guest = from(room, "Pest", "10.0.0.2");
    const other = from(room, "Fine", "10.0.0.3");
    if (typeof host.seat === "string" || typeof guest.seat === "string") throw new Error();
    if (typeof other.seat === "string") throw new Error();
    expect(room.kick(other.seat, guest.seat.id, 0)).toBe("not_host");
    expect(room.kick(host.seat, host.seat.id, 0)).toBe("not_found");
    expect(room.kick(host.seat, 99, 0)).toBe("not_found");
    expect(room.kick(host.seat, guest.seat.id, 0)).toBeUndefined();
    expect(guest.peer.last("ended").reason).toBe("removed");
    expect(room.holds(guest.seat)).toBe(false);
    expect(other.peer.last("lobby").players.map((p) => p.name)).toEqual(["Host", "Fine"]);
    expect(room.join("Pest again", new FakePeer(), 0, "10.0.0.2")).toBe("removed");
    expect(room.bars("10.0.0.2")).toBe(true);
    expect(typeof room.join("New", new FakePeer(), 0, "10.0.0.4")).toBe("object");
  });

  it("removes nobody once the game has started", () => {
    const room = new Room("game0000", HOSTED, 1);
    const host = from(room, "Host", "10.0.0.1");
    const guest = from(room, "Guest", "10.0.0.2");
    if (typeof host.seat === "string" || typeof guest.seat === "string") throw new Error();
    room.requestStart(host.seat, 0);
    expect(room.kick(host.seat, guest.seat.id, 0)).toBe("game_started");
    expect(room.holds(guest.seat)).toBe(true);
  });

  it("takes three players from one address in a public game, any number in a private one", () => {
    const listed = new Room("game0000", { ...HOSTED, capacity: 8, autoStart: false }, 1);
    for (const name of ["A", "B", "C"])
      expect(typeof from(listed, name, "10.0.0.1").seat).toBe("object");
    expect(listed.atSeatLimit("10.0.0.1")).toBe(true);
    expect(from(listed, "D", "10.0.0.1").seat).toBe("too_many_seats");
    expect(typeof from(listed, "E", "10.0.0.2").seat).toBe("object");

    const unlisted = new Room("game0001", { ...PRIVATE, capacity: 8 }, 1);
    for (const name of ["A", "B", "C", "D"])
      expect(typeof from(unlisted, name, "10.0.0.1").seat).toBe("object");
    expect(unlisted.atSeatLimit("10.0.0.1")).toBe(false);

    const open = new Room("game0002", { ...HOSTED, capacity: 8, seatsPerAddress: 0 }, 1);
    for (const name of ["A", "B", "C", "D"])
      expect(typeof from(open, name, "10.0.0.1").seat).toBe("object");
  });

  it("frees the address's seat when one of its players leaves", () => {
    const room = new Room("game0000", { ...HOSTED, capacity: 8, autoStart: false }, 1);
    const seats = ["A", "B", "C"].map((name) => from(room, name, "10.0.0.1").seat);
    const [first] = seats;
    if (!first || typeof first === "string") throw new Error();
    room.leave(first, 0);
    expect(typeof from(room, "D", "10.0.0.1").seat).toBe("object");
  });
});

describe("countdown of a quick game (R-MODE-04)", () => {
  it("can be stopped once by the host, who then starts the game", () => {
    const room = new Room("game0000", PUBLIC, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest", 1_000);
    expect(room.hold(guest.seat, 2_000)).toBe("not_host");
    expect(room.hold(host.seat, 2_000)).toBeUndefined();
    expect(guest.peer.last("lobby")).toMatchObject({ startsIn: null, holdable: false });
    room.update(60_000);
    expect(room.state).toBe("open");
    // A third player does not start the countdown again.
    seated(room, "Third", 61_000);
    expect(room.startsIn(61_000)).toBeNull();
    expect(room.requestStart(host.seat, 62_000)).toBeUndefined();
    expect(room.state).toBe("running");
  });

  it("can be cut short by the host", () => {
    const room = new Room("game0000", PUBLIC, 1);
    const host = seated(room, "Host");
    seated(room, "Guest");
    expect(room.requestStart(host.seat, 100)).toBeUndefined();
    expect(room.state).toBe("running");
  });
});

describe("lone player of a quick game (R-MODE-04)", () => {
  const QUICK: RoomSettings = { ...PUBLIC, soloBots: 7 };

  it("starts with bots at the end of the countdown", () => {
    const room = new Room("game0000", QUICK, 1);
    const alone = seated(room, "Alone", 0);
    expect(alone.peer.last("lobby")).toMatchObject({ startsIn: 10_000, holdable: true });
    expect(room.requestStart(alone.seat, 1_000)).toBe("not_enough_players");
    room.update(10_000);
    expect(alone.peer.last("started")).toMatchObject({ bots: 7, players: [{ id: 1 }] });
  });

  it("leaves at least half the countdown when the second player arrives", () => {
    const room = new Room("game0000", QUICK, 1);
    seated(room, "First", 0);
    expect(room.startsIn(0)).toBe(10_000);
    seated(room, "Second", 8_000);
    expect(room.startsIn(8_000)).toBe(5_000);
    seated(room, "Third", 9_000);
    expect(room.startsIn(9_000)).toBe(4_000);
    const early = new Room("game0001", QUICK, 1);
    seated(early, "First", 0);
    seated(early, "Second", 1_000);
    expect(early.startsIn(1_000)).toBe(9_000);
  });

  it("adds no bots when an opponent came", () => {
    const room = new Room("game0000", QUICK, 1);
    const first = seated(room, "First", 0);
    seated(room, "Second", 4_000);
    room.update(10_000);
    expect(first.peer.last("started").bots).toBe(0);
  });

  it("waits for the host instead once the countdown is stopped", () => {
    const room = new Room("game0000", QUICK, 1);
    const alone = seated(room, "Alone", 0);
    room.hold(alone.seat, 1_000);
    room.update(60_000);
    expect(room.state).toBe("open");
  });
});

describe("host who walked away (R-MODE-04)", () => {
  it("hands the role to the player at the screen most recently", () => {
    const room = new Room("game0000", HOSTED, 1);
    const host = seated(room, "Host", 0);
    const early = seated(room, "Early", 0);
    const late = seated(room, "Late", 0);
    room.touch(early.seat, 30_000);
    room.touch(late.seat, 90_000);
    room.update(119_999);
    expect(late.peer.last("lobby").host).toBe(1);
    room.update(120_000);
    expect(late.peer.last("lobby").host).toBe(3);
    expect(room.requestStart(host.seat, 120_000)).toBe("not_host");
    expect(room.requestStart(late.seat, 120_000)).toBeUndefined();
  });

  it("keeps a host who is still there, or alone", () => {
    const busy = new Room("game0000", HOSTED, 1);
    const host = seated(busy, "Host", 0);
    const guest = seated(busy, "Guest", 0);
    activeUntil(busy, host.seat, 200_000);
    expect(guest.peer.last("lobby").host).toBe(1);

    const alone = new Room("game0001", HOSTED, 1);
    const solo = seated(alone, "Solo", 0);
    alone.update(300_000);
    expect(solo.peer.last("lobby").host).toBe(1);
  });
});

/** Ticks `room` up to `until`, the player sending something every 30 s. */
function activeUntil(room: Room, seat: Seat, until: number): void {
  for (let now = 0; now <= until; now += 1_000) {
    if (now % 30_000 === 0) room.touch(seat, now);
    room.update(now);
  }
}

function running(settings = PRIVATE) {
  const observer = events();
  const room = new Room("game0000", settings, 7, observer);
  const alice = seated(room, "Alice");
  const bob = seated(room, "Bob");
  room.requestStart(alice.seat, 0);
  return { room, alice, bob, observer };
}

describe("saved game", () => {
  it("comes back with its seats, its turns and its clock", () => {
    const { room, alice, bob } = running();
    room.update(100);
    room.submit(bob.seat, { type: "spawn", tile: 2 });
    room.update(200);
    room.leave(bob.seat, 250);
    const saved = room.save(300);
    expect(saved).toMatchObject({ id: "game0000", seed: 7, elapsedMs: 300 });
    room.suspend();
    expect(room.state).toBe("finished");
    expect(alice.peer.inbox.some((message) => message.type === "ended")).toBe(false);

    const observer = events();
    const back = saved && Room.restore(saved, observer, 10_000);
    if (!back) throw new Error("not restored");
    expect(back.state).toBe("running");
    expect(back.connectedCount).toBe(0);
    expect(back.seatFor(bob.seat.token)).toBeUndefined();
    const seat = back.seatFor(alice.seat.token);
    if (!seat) throw new Error("no seat");
    const peer = new FakePeer();
    expect(back.rejoin(seat, peer, 1, 10_000)).toBeUndefined();
    expect(peer.last("started")).toMatchObject({ you: 1, seed: 7, token: alice.seat.token });
    expect(peer.turns()).toEqual([
      { tick: 1, orders: [{ player: 2, order: { type: "spawn", tile: 2 } }] },
    ]);
    back.update(10_100);
    expect(peer.turns().at(-1)?.tick).toBe(2);
    expect(observer.log).toEqual([]);
  });

  it("frees the seats of players who do not come back, and keeps the time limit", () => {
    const { room } = running({ ...PRIVATE, maxDurationMs: 60_000 });
    const saved = room.save(50_000);
    if (!saved) throw new Error("not saved");
    const back = Room.restore(saved, events(), 1_000_000);
    back?.update(1_009_000);
    expect(back?.state).toBe("running");
    back?.update(1_011_000);
    expect(back?.state).toBe("finished");
    const late = Room.restore(saved, events(), 0);
    late?.update(PRIVATE.reconnectGraceMs);
    expect(late?.state).toBe("finished");
  });

  it("puts the orders not yet in a turn into one more turn", () => {
    const { room, alice } = running();
    room.update(100);
    room.submit(alice.seat, { type: "spawn", tile: 4 });
    const saved = room.save(150);
    expect(saved?.log.ends).toHaveLength(2);
    expect(alice.peer.turns().at(-1)).toEqual({
      tick: 1,
      orders: [{ player: 1, order: { type: "spawn", tile: 4 } }],
    });
    expect(room.save(160)?.log.ends).toHaveLength(2);
  });

  it("is only a running game", () => {
    const room = new Room("game0000", PRIVATE, 1);
    seated(room, "Host");
    expect(room.save(0)).toBeUndefined();
  });

  it("is refused with a broken log", () => {
    const { room } = running();
    room.update(100);
    const saved = room.save(100);
    if (!saved) throw new Error("not saved");
    expect(
      Room.restore({ ...saved, log: { ...saved.log, ends: Uint32Array.from([99]) } }, {}, 0),
    ).toBeUndefined();
  });
});

describe("running game", () => {
  it("relays orders in turns numbered from zero, in arrival order", () => {
    const { room, alice, bob } = running();
    room.update(100);
    expect(room.submit(bob.seat, { type: "spawn", tile: 2 })).toBe(true);
    expect(room.submit(alice.seat, { type: "spawn", tile: 1 })).toBe(true);
    room.update(200);
    const expected = [
      { tick: 0, orders: [] },
      {
        tick: 1,
        orders: [
          { player: 2, order: { type: "spawn", tile: 2 } },
          { player: 1, order: { type: "spawn", tile: 1 } },
        ],
      },
    ];
    expect(alice.peer.turns()).toEqual(expected);
    expect(bob.peer.turns()).toEqual(expected);
    expect(room.log.length).toBe(2);
  });

  it("closes as many turns per tick as its speed, the new orders in the first (R-MODE-07)", () => {
    const room = new Room("game0000", { ...PRIVATE, speed: 4 }, 1);
    const alice = seated(room, "Alice");
    room.requestStart(alice.seat, 0);
    expect(alice.peer.last("lobby")).toMatchObject({ speed: 4 });
    expect(alice.peer.last("started")).toMatchObject({ speed: 4, tickRate: 10 });
    room.submit(alice.seat, { type: "spawn", tile: 1 });
    room.update(100);
    expect(alice.peer.turns()).toEqual([
      { tick: 0, orders: [{ player: 1, order: { type: "spawn", tile: 1 } }] },
      { tick: 1, orders: [] },
      { tick: 2, orders: [] },
      { tick: 3, orders: [] },
    ]);
    // The four turns of one tick travel in one frame.
    expect(alice.peer.inbox.filter((message) => message.type === "turns")).toHaveLength(1);
  });

  it("drops orders beyond the cap of one player in one turn", () => {
    const { room, alice, bob } = running();
    for (let tile = 0; tile < 5; tile++) room.submit(alice.seat, { type: "spawn", tile });
    expect(room.submit(bob.seat, { type: "spawn", tile: 9 })).toBe(true);
    room.update(100);
    expect(alice.peer.turns()[0]?.orders).toHaveLength(4);
    expect(room.submit(alice.seat, { type: "spawn", tile: 1 })).toBe(true);
  });

  it("stops a game whose turn log grows too large", () => {
    const { room, alice } = running({ ...PRIVATE, maxLogBytes: 10_000 });
    for (let now = 100; now <= 300_000 && room.state === "running"; now += 100) {
      room.submit(alice.seat, { type: "attack", target: 2 ** 30, troops: 2 ** 40 });
      room.update(now);
    }
    expect(room.state).toBe("finished");
    expect(alice.peer.last("ended").reason).toBe("timeout");
  });

  it("ignores orders before the start and from players who left", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const alice = seated(room, "Alice");
    expect(room.submit(alice.seat, { type: "spawn", tile: 1 })).toBe(false);
    const bob = seated(room, "Bob");
    room.requestStart(alice.seat, 0);
    room.leave(bob.seat, 0);
    expect(room.submit(bob.seat, { type: "spawn", tile: 1 })).toBe(false);
    expect(room.playerCount).toBe(1);
  });

  it("keeps a dropped player's seat and replays the missed turns on rejoin", () => {
    const { room, alice, bob } = running();
    room.update(100);
    room.disconnect(bob.seat, 100);
    expect(room.connectedCount).toBe(1);
    room.submit(alice.seat, { type: "spawn", tile: 5 });
    room.update(200);
    room.update(300);

    const back = new FakePeer();
    expect(room.rejoin(bob.seat, back, 1, 0)).toBeUndefined();
    expect(back.last("started")).toMatchObject({ you: 2, token: bob.seat.token });
    expect(back.turns()).toEqual([
      { tick: 1, orders: [{ player: 1, order: { type: "spawn", tile: 5 } }] },
      { tick: 2, orders: [] },
    ]);
    room.update(400);
    expect(back.turns().at(-1)?.tick).toBe(3);
  });

  it("refuses a token whose seat is still connected, and checks that connection", () => {
    const { room, bob } = running();
    expect(room.rejoin(bob.seat, new FakePeer(), 0, 0)).toBe("token_in_use");
    expect(bob.peer.probes).toBe(1);
  });

  it("frees a seat whose player stays away too long", () => {
    const { room, alice, bob } = running();
    room.disconnect(bob.seat, 0);
    room.update(PRIVATE.reconnectGraceMs);
    expect(room.rejoin(bob.seat, new FakePeer(), 0, 0)).toBe("token_invalid");
    expect(room.seatFor(bob.seat.token)).toBeUndefined();
    expect(room.seatFor(alice.seat.token)).toBe(alice.seat);
  });

  it("ends when every player is gone", () => {
    const { room, alice, bob, observer } = running();
    room.leave(alice.seat, 0);
    room.disconnect(bob.seat, 0);
    room.update(1_000);
    expect(room.state).toBe("running");
    room.update(PRIVATE.reconnectGraceMs);
    expect(room.state).toBe("finished");
    expect(observer.log).toContain("finished:abandoned");
  });

  it("ends a game that runs too long", () => {
    const { room, alice, observer } = running();
    room.update(PRIVATE.maxDurationMs);
    expect(room.state).toBe("finished");
    expect(alice.peer.last("ended").reason).toBe("timeout");
    expect(observer.log).toContain("finished:timeout");
    expect(room.holds(alice.seat)).toBe(false);
  });

  it("stops at once on request", () => {
    const { room, bob } = running();
    room.stop();
    expect(bob.peer.last("ended").reason).toBe("abandoned");
    room.stop();
    expect(room.state).toBe("finished");
  });
});

describe("desync detection", () => {
  function threePlayers() {
    const observer = events();
    const room = new Room("game0000", PRIVATE, 7, observer);
    const players = ["A", "B", "C"].map((name) => seated(room, name));
    const [a] = players;
    if (!a) throw new Error("no host");
    room.requestStart(a.seat, 0);
    for (let now = 100; now <= 20_000; now += 100) room.update(now);
    return { room, players, observer };
  }

  it("flags only the player whose hash differs from the majority", () => {
    const { room, players, observer } = threePlayers();
    const [a, b, c] = players;
    if (!a || !b || !c) throw new Error("missing player");
    room.reportHash(a.seat, 50, 1234);
    room.reportHash(b.seat, 50, 1234);
    room.reportHash(c.seat, 50, 1234);
    expect(room.desynced).toBe(false);

    room.reportHash(a.seat, 100, 7);
    room.reportHash(b.seat, 100, 7);
    expect(room.desynced).toBe(false);
    room.reportHash(c.seat, 100, 8);
    expect(room.desynced).toBe(true);
    expect(c.peer.last("desync")).toEqual({ type: "desync", tick: 100, hash: 8, expected: 7 });
    expect(a.peer.inbox.some((message) => message.type === "desync")).toBe(false);
    expect(observer.log.filter((entry) => entry.startsWith("desync"))).toEqual(["desync:100:8:7"]);

    room.disconnect(c.seat, 20_000);
    const back = new FakePeer();
    room.rejoin(c.seat, back, 150, 0);
    expect(back.last("desync")).toMatchObject({ tick: 100, hash: 8, expected: 7 });

    // A reload replays the game from the first turn: the flag goes, and the next hashes decide.
    room.disconnect(c.seat, 20_000);
    const reloaded = new FakePeer();
    room.rejoin(c.seat, reloaded, 0, 0);
    expect(reloaded.inbox.some((message) => message.type === "desync")).toBe(false);
    expect(room.desynced).toBe(false);
    room.reportHash(a.seat, 150, 9);
    room.reportHash(b.seat, 150, 9);
    room.reportHash(c.seat, 150, 9);
    expect(room.desynced).toBe(false);
  });

  it("cannot be used by one client to flag the others", () => {
    const { room, players } = threePlayers();
    const [a, b, c] = players;
    if (!a || !b || !c) throw new Error("missing player");
    room.reportHash(c.seat, 50, 666);
    room.reportHash(c.seat, 50, 1);
    room.reportHash(a.seat, 50, 1);
    room.reportHash(b.seat, 50, 1);
    expect(c.peer.last("desync").tick).toBe(50);
    expect(a.peer.inbox.some((message) => message.type === "desync")).toBe(false);
  });

  it("flags both players of a split without a majority", () => {
    const { room, alice, bob } = running();
    for (let now = 100; now <= 6_000; now += 100) room.update(now);
    room.reportHash(alice.seat, 50, 1);
    room.reportHash(bob.seat, 50, 2);
    expect(alice.peer.last("desync")).toMatchObject({ tick: 50, hash: 1, expected: null });
    expect(bob.peer.last("desync").tick).toBe(50);
  });

  it("only checks the ticks clients are asked to hash, once they have run", () => {
    const { room, alice, bob } = running();
    room.reportHash(alice.seat, 0, 1);
    room.reportHash(bob.seat, 0, 2);
    expect(room.desynced).toBe(false);
    room.update(100);
    room.reportHash(alice.seat, 0, 1);
    room.reportHash(bob.seat, 0, 2);
    expect(room.desynced).toBe(true);

    const other = running();
    for (let now = 100; now <= 6_000; now += 100) other.room.update(now);
    other.room.reportHash(other.alice.seat, 49, 1);
    other.room.reportHash(other.bob.seat, 49, 2);
    other.room.reportHash(other.alice.seat, 100, 1);
    other.room.reportHash(other.bob.seat, 100, 2);
    expect(other.room.desynced).toBe(false);
  });

  it("compares late hashes without waiting for players who never report", () => {
    const { room, players } = threePlayers();
    const [a, b] = players;
    if (!a || !b) throw new Error("missing player");
    room.reportHash(a.seat, 150, 1);
    room.reportHash(b.seat, 150, 2);
    expect(room.desynced).toBe(false);
    for (let now = 20_100; now <= 80_000; now += 100) room.update(now);
    expect(room.desynced).toBe(true);
    // Too old to be compared any more.
    room.reportHash(a.seat, 200, 1);
    expect(a.peer.inbox.filter((message) => message.type === "desync")).toHaveLength(1);
  });
});

describe("host handover with dropped connections (R-MODE-04)", () => {
  const KEPT: RoomSettings = { ...HOSTED, lobbyGraceMs: 30_000 };

  it("never hands the role to a player whose connection dropped", () => {
    const room = new Room("game0000", KEPT, 1);
    const host = seated(room, "Host", 0);
    const quiet = seated(room, "Quiet", 0);
    const dropped = seated(room, "Dropped", 0);
    room.touch(dropped.seat, 100_000);
    room.disconnect(dropped.seat, 100_000);
    room.update(120_000);
    expect(quiet.peer.last("lobby").host).toBe(2);
    room.leave(quiet.seat, 121_000);
    expect(room.requestStart(host.seat, 121_000)).toBeUndefined();
  });

  it("keeps the role of a host whose seat waits for them", () => {
    const room = new Room("game0000", KEPT, 1);
    const host = seated(room, "Host", 0);
    const guest = seated(room, "Guest", 0);
    room.touch(guest.seat, 100_000);
    room.disconnect(host.seat, 110_000);
    room.update(125_000);
    expect(guest.peer.last("lobby").host).toBe(1);
  });

  it("gives the role of a host who leaves to a connected player first", () => {
    const room = new Room("game0000", KEPT, 1);
    const host = seated(room, "Host", 0);
    const away = seated(room, "Away", 0);
    const here = seated(room, "Here", 0);
    room.disconnect(away.seat, 1_000);
    room.leave(host.seat, 2_000);
    expect(here.peer.last("lobby").host).toBe(here.seat.id);
  });
});
