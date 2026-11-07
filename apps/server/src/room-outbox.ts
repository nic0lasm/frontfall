import {
  encodeServerMessage,
  encodeTurnsFrame,
  type Frame,
  type ServerMessage,
} from "@frontfall/protocol";

/** The connection of one player, as the room sees it. */
export interface Peer {
  send(frame: Frame): void;
  /**
   * Sends the frames of a catch-up, then `last` if any. A connection may pace
   * them by what the client reads; the frames must then run on to the end of
   * the log, and live turns it would get meanwhile are covered by them.
   */
  replay?(frames: Iterable<Frame>, last?: Frame): void;
  /** Asks the connection to prove it is alive, and drops it if it does not answer. */
  probe(): void;
}

/**
 * A client that leaves this much unread, a sleeping tab or a stalled network,
 * is dropped: it rejoins from its last turn, and its backlog never weighs on the
 * server. A 4-hour game sent whole takes about 1.5 MiB, in frames paced apart.
 */
export const MAX_BUFFERED_BYTES = 4 * 2 ** 20;

/** What the outbox of one connection needs of it; a transport's `Connection` has it. */
export interface Link {
  /** Whether frames may still be sent. */
  readonly open: boolean;
  /** Bytes sent and not yet handed to the network. */
  readonly bufferedAmount: number;
  /** Sends one frame; `sent` runs once it is handed to the network. */
  send(frame: Frame, sent?: () => void): void;
  /** Drops the connection at once. */
  terminate(): void;
}

export interface PeerEvents {
  /** The client left more than `MAX_BUFFERED_BYTES` unread and was dropped. */
  slow(): void;
  /** The room asks the connection to prove it is alive. */
  probe(): void;
}

/**
 * The outbox of one connection, through which everything it is sent goes: a
 * catch-up runs frame by frame, each once the last is handed to the network,
 * and the other messages wait for its end; past it, a client that stops
 * reading is cut at `MAX_BUFFERED_BYTES`. Every frame is sent to this peer
 * alone, never through a topic shared by a room, so a seat that catches up
 * never sees a live turn before its backlog.
 */
export function peerOutbox(link: Link, events: PeerEvents): Peer {
  /** A catch-up under way: the frames left, and the messages held until its end. */
  let replaying: { frames: Iterator<Frame>; held: Frame[] } | undefined;
  // One frame at a time, the next once the last is handed to the network: a
  // rejoin from the first turn of a long game never piles up in memory.
  const pump = (): void => {
    const current = replaying;
    if (!current || !link.open) return;
    const next = current.frames.next();
    if (next.done !== true) {
      link.send(next.value, pump);
      return;
    }
    replaying = undefined;
    for (const frame of current.held) link.send(frame);
  };
  return {
    send(frame) {
      if (!link.open) return;
      if (replaying) {
        // The catch-up runs on to the newest turn; other messages wait for its end.
        if (typeof frame === "string") replaying.held.push(frame);
        return;
      }
      if (link.bufferedAmount > MAX_BUFFERED_BYTES) {
        events.slow();
        link.terminate();
        return;
      }
      link.send(frame);
    },
    replay(frames, last) {
      replaying = { frames: frames[Symbol.iterator](), held: last === undefined ? [] : [last] };
      pump();
    },
    probe() {
      events.probe();
    },
  };
}

/** A seat as the outbox of its room sees it: the peer it is reached through, while it has one. */
export interface Addressee {
  readonly peer: Peer | undefined;
}

/**
 * What a room sends, encoded here and handed to the peer of each seat: to one
 * seat, to every seat, the turns, and the catch-up of a seat that rejoins.
 */
export class RoomOutbox {
  /** `seats` is the room's own list, read at each send. */
  constructor(private readonly seats: readonly Addressee[]) {}

  /** Sends `message` to one seat, if it is connected. */
  toSeat(seat: Addressee, message: ServerMessage): void {
    seat.peer?.send(encodeServerMessage(message));
  }

  /** Sends `message` to every connected seat, encoded once. */
  toEverySeat(message: ServerMessage): void {
    this.sendAll(encodeServerMessage(message));
  }

  /** Sends the turns from `tick` on, in one frame. */
  turns(tick: number, bodies: readonly Uint8Array[]): void {
    this.sendAll(encodeTurnsFrame(tick, bodies));
  }

  /**
   * Sends a seat the frames of the turns it missed, then `last` if any. A peer
   * that paces a catch-up gets the frames as they come, the others at once.
   */
  catchUp(seat: Addressee, frames: Iterable<Frame>, last?: ServerMessage): void {
    const { peer } = seat;
    if (!peer) return;
    const final = last === undefined ? undefined : encodeServerMessage(last);
    if (peer.replay) {
      peer.replay(frames, final);
      return;
    }
    for (const frame of frames) peer.send(frame);
    if (final !== undefined) peer.send(final);
  }

  private sendAll(frame: Frame): void {
    for (const seat of this.seats) seat.peer?.send(frame);
  }
}
