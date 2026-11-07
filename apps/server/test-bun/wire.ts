import { connect, type Socket } from "node:net";

/** Sends `text` as written on a new TCP connection, and resolves with all it reads until the close. */
export function exchange(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let read = "";
    socket.on("data", (chunk: Buffer) => (read += chunk.toString("latin1")));
    socket.on("error", reject);
    socket.on("close", () => {
      resolve(read);
    });
    socket.write(text);
  });
}

/** One frame from the server: its opcode and payload. */
export interface WireFrame {
  opcode: number;
  payload: Buffer;
}

export const TEXT = 0x1;
export const BINARY = 0x2;
export const CLOSE = 0x8;
export const PING = 0x9;
export const PONG = 0xa;

const KEY = "dGhlIHNhbXBsZSBub25jZQ==";

/**
 * A WebSocket client written on a bare TCP socket, so a test can do what a
 * browser never does: send a broken handshake, leave pings unanswered, or
 * stop reading altogether.
 */
export class WireSocket {
  /** Resolves once the TCP connection is gone, for whatever reason. */
  readonly ended: Promise<void>;
  private buffer = Buffer.alloc(0);
  private readonly frames: WireFrame[] = [];
  private waiters: (() => void)[] = [];
  private gone = false;

  private constructor(
    private readonly socket: Socket,
    readonly status: number,
    rest: Buffer,
    private readonly autoPong: boolean,
  ) {
    this.ended = new Promise((resolve) => {
      socket.on("close", () => {
        this.gone = true;
        this.wake();
        resolve();
      });
    });
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      this.take(chunk);
    });
    this.take(rest);
  }

  /**
   * Opens `path` with the headers given; `status` is the answer to the
   * handshake, 101 when the WebSocket is open.
   */
  static open(
    port: number,
    path = "/ws",
    headers: Record<string, string> = {},
    options: { autoPong?: boolean; key?: string } = {},
  ): Promise<WireSocket> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.off("data", onData);
        socket.off("error", reject);
        const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head.toString("latin1"))?.[1] ?? 0);
        resolve(new WireSocket(socket, status, head.subarray(end + 4), options.autoPong ?? true));
      };
      socket.on("data", onData);
      socket.on("error", reject);
      const lines = [
        `GET ${path} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${options.key ?? KEY}`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      ];
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
  }

  /** Sends one masked frame, as a client must. */
  send(data: string | Uint8Array, opcode = typeof data === "string" ? TEXT : BINARY): void {
    const payload = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    const mask = Buffer.from([1, 2, 3, 4]);
    let header: Buffer;
    if (payload.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)));
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  /** The next frame from the server but pings, or undefined once the connection is gone. */
  async next(): Promise<WireFrame | undefined> {
    for (;;) {
      const frame = this.frames.shift();
      if (frame?.opcode === PING) continue;
      if (frame) return frame;
      if (this.gone) return undefined;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** The code of the close frame the server sends, skipping what comes before it; 1006 without one. */
  async closeCode(): Promise<number> {
    for (;;) {
      const frame = await this.next();
      if (!frame) return 1006;
      if (frame.opcode === CLOSE)
        return frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005;
    }
  }

  /** Stops reading: what the server sends piles up in the kernel's buffers, then in its own. */
  pause(): void {
    this.socket.pause();
  }

  resume(): void {
    this.socket.resume();
  }

  destroy(): void {
    this.socket.destroy();
  }

  private take(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) break;
      const opcode = (this.buffer[0] ?? 0) & 0x0f;
      let length = (this.buffer[1] ?? 0) & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) break;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) break;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) break;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === PING && this.autoPong) this.send(payload, PONG);
      this.frames.push({ opcode, payload: Buffer.from(payload) });
    }
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }
}
