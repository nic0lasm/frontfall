import type { Frame } from "@frontfall/protocol";
import type { Server, ServerWebSocket } from "bun";
import type {
  Connection,
  ConnectionEvents,
  HttpRequest,
  HttpResponse,
  ReplyHeaders,
  RequestBody,
  Transport,
  TransportHandler,
  UpgradeAnswer,
} from "./transport.ts";

/**
 * An HTTP connection that sends nothing for this long is closed, in seconds:
 * headers that trickle in, or a body that never ends, must not hold a socket
 * for minutes. A proxy usually cuts them sooner; a server reached directly relies on this.
 */
const HTTP_IDLE_SECONDS = 10;

/**
 * Once a request is fully read, the time its handler has to answer, in
 * seconds. Bun's idle timeout also runs while a handler waits, and the
 * sign-in callback waits on two calls to the provider of up to 10 seconds each.
 */
const ANSWER_SECONDS = 30;

/**
 * Frames past this size are refused by Bun itself, before they are read.
 * Below it and past the server's own limit, the transport refuses them, so
 * that the close code and the count of refusals are the same.
 */
const MAX_FRAME_BYTES = 64 * 1024;

/** What Bun says when it closes a connection for a frame past `MAX_FRAME_BYTES`. */
const TOO_BIG = "Received too big message";

/** `readyState` of an open WebSocket. */
const OPEN = 1;

/** Statuses whose answer has no body. */
const NO_BODY = new Set([204, 205, 304]);

/** What one WebSocket carries from the request that opened it. */
interface SocketData {
  readonly answer: Extract<UpgradeAnswer, { accept: unknown }>;
  connection?: BunConnection;
  events?: ConnectionEvents;
}

/** Whether the request asks to switch to another protocol, as Node's "upgrade" event tells it. */
function asksUpgrade(request: Request): boolean {
  const connection = request.headers.get("connection") ?? "";
  return (
    request.headers.get("upgrade") !== null &&
    connection
      .toLowerCase()
      .split(",")
      .some((token) => token.trim() === "upgrade")
  );
}

/**
 * The request target as the client sent it. Bun gives the URL with the
 * scheme and the Host in front, the path kept as written: `//host/path` stays
 * so, and only a backslash reads as a slash. With no Host, or one that is not
 * a valid authority (`a/b`, `user@host`), Bun gives the target alone, which
 * starts with a slash and is kept whole.
 */
export function requestTarget(url: string): string {
  if (url.startsWith("/")) return url;
  const authority = url.indexOf("//");
  const path = url.indexOf("/", authority + 2);
  return path < 0 ? "/" : url.slice(path);
}

async function readBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  received: () => void,
): Promise<RequestBody> {
  if (!body) return { kind: "read", bytes: new Uint8Array() };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "aborted" };
  }
  received();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "read", bytes };
}

/** `received` runs once the request is fully read: at once with no body, else after the body. */
function httpRequest(
  request: Request,
  peer: string | undefined,
  received: () => void,
): HttpRequest {
  return {
    method: request.method,
    url: requestTarget(request.url),
    header: (name) => request.headers.get(name) ?? undefined,
    peer,
    body: (limit) => readBody(request.body, limit, received),
  };
}

function headersOf(reply: ReplyHeaders | undefined): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(reply ?? {})) {
    const values: readonly (string | number)[] = Array.isArray(value) ? value : [value as string];
    for (const one of values) headers.append(name, String(one));
  }
  return headers;
}

/**
 * An answer that cuts the connection without a status: Bun resets a
 * connection whose body fails before its first byte. Failing with no reason
 * keeps Bun from printing the error.
 */
function cut(): Response {
  return new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(undefined);
      },
    }),
  );
}

/** A Bun WebSocket behind the transport's interface. */
class BunConnection implements Connection {
  private closing = false;
  /** `sent` callbacks of frames Bun queued behind others, run at the next drain. */
  private waiting: (() => void)[] = [];

  constructor(private readonly socket: ServerWebSocket<SocketData>) {}

  get open(): boolean {
    return !this.closing && this.socket.readyState === OPEN;
  }

  get bufferedAmount(): number {
    return this.socket.getBufferedAmount();
  }

  send(frame: Frame, sent?: () => void): void {
    const status = this.socket.send(frame);
    if (!sent) return;
    // -1: queued behind what the client has not read yet; it is handed on at a drain.
    if (status === -1 && this.open) this.waiting.push(sent);
    else setImmediate(sent);
  }

  ping(): void {
    if (this.open) this.socket.ping();
  }

  close(code: number, reason: string): void {
    if (!this.open) return;
    this.closing = true;
    this.socket.close(code, reason);
  }

  terminate(): void {
    this.closing = true;
    this.socket.terminate();
  }

  drained(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const sent of waiting) sent();
  }

  closed(): void {
    this.closing = true;
    this.drained();
  }
}

/** HTTP and WebSockets from `Bun.serve`, on one port. Every frame goes to one connection, never to a topic. */
export class BunTransport implements Transport {
  private handler: TransportHandler | undefined;
  private server: Server<SocketData> | undefined;
  private readonly open = new Set<BunConnection>();

  /** The two deadlines in seconds; tests shorten them. */
  constructor(private readonly deadlines = { idle: HTTP_IDLE_SECONDS, answer: ANSWER_SECONDS }) {}

  serve(handler: TransportHandler): void {
    this.handler = handler;
  }

  listen(port: number, host?: string): Promise<{ port: number }> {
    const handler = this.served();
    const server = Bun.serve<SocketData>({
      port,
      ...(host !== undefined && { hostname: host }),
      idleTimeout: this.deadlines.idle,
      development: false,
      fetch: (request, server) => this.fetch(handler, request, server),
      websocket: {
        maxPayloadLength: Math.max(MAX_FRAME_BYTES, handler.maxPayloadBytes),
        // The server pings and drops silent sockets itself (ws/sessions.ts).
        idleTimeout: 0,
        sendPings: false,
        open: (socket) => {
          const connection = new BunConnection(socket);
          socket.data.connection = connection;
          this.open.add(connection);
          socket.data.events = socket.data.answer.accept(connection);
        },
        message: (socket, message) => {
          const { events, connection } = socket.data;
          const frame: Frame =
            typeof message === "string"
              ? message
              : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
          const size = typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
          if (size > handler.maxPayloadBytes) {
            events?.error("oversized");
            connection?.close(1009, "Max payload size exceeded");
            return;
          }
          events?.message(frame);
        },
        pong: (socket) => {
          socket.data.events?.pong();
        },
        drain: (socket) => {
          socket.data.connection?.drained();
        },
        close: (socket, code, reason) => {
          const { connection, events, answer } = socket.data;
          if (connection) {
            this.open.delete(connection);
            connection.closed();
          }
          if (reason === TOO_BIG) events?.error("oversized");
          else if (code === 1002) events?.error("invalid");
          events?.close(code);
          answer.released?.();
        },
      },
    });
    this.server = server;
    return Promise.resolve({ port: server.port ?? port });
  }

  connections(): Iterable<Connection> {
    return this.open;
  }

  get connectionCount(): number {
    return this.open.size;
  }

  async close(): Promise<void> {
    // Waits for the requests in flight and the WebSockets still open.
    await this.server?.stop();
  }

  private fetch(
    handler: TransportHandler,
    request: Request,
    server: Server<SocketData>,
  ): Response | Promise<Response> | undefined {
    const peer = server.requestIP(request)?.address;
    const { idle, answer } = this.deadlines;
    const received = () => {
      server.timeout(request, answer);
    };
    const wrapped = httpRequest(request, peer, received);
    if (asksUpgrade(request)) return this.upgrade(handler.upgrade(wrapped), request, server);
    // A body still to come stays under the idle timeout until it is read.
    if (request.body === null) received();
    return new Promise<Response>((resolve) => {
      let answered = false;
      const answerWith = (reply: Response) => {
        answered = true;
        // A connection kept open for the next request is idle again.
        server.timeout(request, idle);
        resolve(reply);
      };
      const response: HttpResponse = {
        send(status, headers, body) {
          if (answered) return;
          // Bytes go as they are, not copied; the DOM's typings, read by the bench, want an ArrayBuffer behind them.
          const sent = (NO_BODY.has(status) ? null : (body ?? null)) as ConstructorParameters<
            typeof Response
          >[0];
          answerWith(new Response(sent, { status, headers: headersOf(headers) }));
        },
        abort() {
          if (answered) return;
          answerWith(cut());
        },
      };
      handler.request(wrapped, response);
    });
  }

  private upgrade(
    answer: UpgradeAnswer,
    request: Request,
    server: Server<SocketData>,
  ): Response | undefined {
    if ("refuse" in answer) {
      return new Response(null, { status: answer.refuse, headers: { connection: "close" } });
    }
    if (server.upgrade(request, { data: { answer } })) return undefined;
    // A handshake Bun cannot complete, such as a bad key: the slot taken for it goes back.
    answer.released?.();
    return new Response("Bad Request", { status: 400, headers: { connection: "close" } });
  }

  private served(): TransportHandler {
    if (!this.handler) throw new Error("the transport serves no server yet");
    return this.handler;
  }
}
