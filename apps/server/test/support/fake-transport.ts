import { EventEmitter } from "node:events";
import type { Frame } from "@frontfall/protocol";
import type {
  Connection,
  ConnectionEvents,
  HttpRequest,
  HttpResponse,
  ReplyHeaders,
  RequestBody,
  Transport,
  TransportHandler,
} from "../../src/transport.ts";

/** A request as the fake takes it: the target is passed as is, never resolved. */
export interface FakeRequest {
  method?: string;
  /** The request target, such as `/api/games` or `//evil.example/x`. */
  url: string;
  /** Names in lower case. */
  headers?: Record<string, string>;
  /** The address the request comes from; the fake's `peer` by default. */
  peer?: string;
  body?: string | Uint8Array;
}

/** An answer, as the transport was handed it. */
export interface FakeReply {
  status: number;
  headers: ReplyHeaders;
  /** Empty for HEAD, whatever the server gave. */
  body: Buffer;
  /** The server cut the connection, after its answer if it gave one. */
  aborted: boolean;
}

/** Statuses whose answer has no body, which `Response` refuses one for. */
const NO_BODY = new Set([204, 205, 304]);

function size(frame: Frame): number {
  return typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
}

/**
 * Answers one request through `handle`, the way a transport would: the
 * answer is the first `send`, a body sent to HEAD is dropped, and an `abort`
 * with no answer before it rejects as a dropped connection does.
 */
export function exchange(
  handle: (request: HttpRequest, response: HttpResponse) => void,
  request: FakeRequest,
  peer = "127.0.0.1",
): Promise<FakeReply> {
  const method = request.method ?? "GET";
  const body =
    typeof request.body === "string"
      ? Buffer.from(request.body)
      : (request.body ?? new Uint8Array());
  const headers = request.headers ?? {};
  return new Promise((resolve, reject) => {
    let answered = false;
    handle(
      {
        method,
        url: request.url,
        header: (name) => headers[name],
        peer: request.peer ?? peer,
        body: (limit) =>
          Promise.resolve<RequestBody>(
            body.byteLength > limit ? { kind: "too_large" } : { kind: "read", bytes: body },
          ),
      },
      {
        send(status, replyHeaders = {}, replyBody) {
          if (answered) throw new Error("answered twice");
          answered = true;
          const bytes =
            method === "HEAD" || replyBody === undefined ? Buffer.alloc(0) : Buffer.from(replyBody);
          resolve({ status, headers: replyHeaders, body: bytes, aborted: false });
        },
        abort() {
          if (!answered) reject(new TypeError("fetch failed: the server cut the connection"));
          answered = true;
        },
      },
    );
  });
}

/** An answer of the fake as `fetch` gives it. */
export function toResponse(reply: FakeReply, method = "GET"): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(reply.headers)) {
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, String(one));
  }
  const empty = NO_BODY.has(reply.status) || method === "HEAD";
  return new Response(empty ? null : new Uint8Array(reply.body), {
    status: reply.status,
    headers,
  });
}

/** The ways a fake WebSocket can be, as the `ws` client numbers them. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * The client end of a WebSocket through the fake, shaped like a `ws` client:
 * `open`, `message` (data, isBinary), `ping`, `error` and `close` (code,
 * reason) events, `send`, `close`, `terminate`, `pause` and `resume`.
 * Everything crosses on a later turn of the event loop, as over a network.
 */
export class FakeSocket extends EventEmitter {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;
  readonly OPEN = OPEN;

  readyState: number = CONNECTING;
  /** The server's end, once the handshake is done. */
  server: FakeConnection | undefined;

  constructor(readonly autoPong: boolean) {
    super();
  }

  send(data: string | Uint8Array): void {
    if (this.readyState === CONNECTING) throw new Error("WebSocket is not open: readyState 0");
    if (this.readyState !== OPEN) return;
    this.server?.receive(typeof data === "string" ? data : new Uint8Array(data));
  }

  /** Starts the closing handshake; without a code the server sees 1005, as from `ws`. */
  close(code?: number, reason = ""): void {
    if (this.readyState !== OPEN) return;
    this.readyState = CLOSING;
    this.server?.closedByClient(code ?? 1005, reason);
  }

  /** Drops the connection without a handshake: the server sees 1006. */
  terminate(): void {
    if (this.readyState === CLOSED) return;
    if (this.server) this.server.drop();
    else this.readyState = CLOSED;
  }

  /** Stops reading, as a frozen tab: what the server sends piles up in its buffer. */
  pause(): void {
    this.server?.hold(true);
  }

  resume(): void {
    this.server?.hold(false);
  }
}

/** The server end of a WebSocket through the fake. */
export class FakeConnection implements Connection {
  private state = OPEN;
  private ended = false;
  private paused = false;
  /** What the server sent and the client has not read yet, in order. */
  private outbox: { bytes: number; deliver: () => void }[] = [];
  private events: ConnectionEvents | undefined;

  constructor(
    private readonly client: FakeSocket,
    private readonly maxPayloadBytes: number,
    private readonly ended$: () => void,
  ) {}

  get open(): boolean {
    return this.state === OPEN;
  }

  get bufferedAmount(): number {
    return this.outbox.reduce((total, item) => total + item.bytes, 0);
  }

  attach(events: ConnectionEvents): void {
    this.events = events;
  }

  send(frame: Frame, sent?: () => void): void {
    if (this.state !== OPEN) {
      // As `ws`, which reports a send after the close to its callback.
      if (sent) setImmediate(sent);
      return;
    }
    const data = typeof frame === "string" ? Buffer.from(frame) : Buffer.from(frame);
    this.toClient(size(frame), () => {
      if (this.client.readyState === OPEN)
        this.client.emit("message", data, typeof frame !== "string");
      sent?.();
    });
  }

  ping(): void {
    if (this.state !== OPEN) return;
    this.toClient(2, () => {
      if (this.client.readyState !== OPEN) return;
      this.client.emit("ping");
      if (this.client.autoPong) this.toServer(() => this.events?.pong());
    });
  }

  close(code: number, reason: string): void {
    if (this.state !== OPEN) return;
    this.state = CLOSING;
    this.toClient(2 + Buffer.byteLength(reason), () => {
      this.end(code, reason);
    });
  }

  terminate(): void {
    this.drop();
  }

  /** A frame from the client, refused past the payload limit as `ws` refuses it, with 1009. */
  receive(frame: Frame): void {
    this.toServer(() => {
      if (this.ended) return;
      if (size(frame) > this.maxPayloadBytes) {
        this.events?.error("oversized");
        this.state = CLOSING;
        this.end(1009, "Max payload size exceeded");
        return;
      }
      this.events?.message(frame);
    });
  }

  closedByClient(code: number, reason: string): void {
    this.toServer(() => {
      this.state = CLOSING;
      this.end(code, reason);
    });
  }

  /** Ends both sides at once, as a dropped TCP connection: 1006, and nothing queued is read. */
  drop(): void {
    this.outbox = [];
    this.state = CLOSED;
    setImmediate(() => {
      this.end(1006, "");
    });
  }

  hold(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.flush();
  }

  /** The close as both ends see it, once. */
  private end(code: number, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.state = CLOSED;
    this.outbox = [];
    this.events?.close(code);
    this.ended$();
    this.client.readyState = CLOSED;
    this.client.emit("close", code, Buffer.from(reason));
  }

  private toClient(bytes: number, deliver: () => void): void {
    this.outbox.push({ bytes, deliver });
    if (this.outbox.length === 1) {
      setImmediate(() => {
        this.flush();
      });
    }
  }

  private flush(): void {
    while (!this.paused && this.outbox.length > 0) this.outbox.shift()?.deliver();
  }

  private toServer(deliver: () => void): void {
    setImmediate(deliver);
  }
}

/**
 * A transport with no socket: tests send requests and open WebSockets
 * through it, and see what the server answers, with every event crossing on
 * a later turn of the event loop. It refuses frames past the payload limit
 * the server sets, as `ws` does. What it does not model is the wire itself:
 * half-sent requests, broken handshakes and TCP buffers; those tests use the
 * Node transport.
 */
export class FakeTransport implements Transport {
  /** The address requests and connections come from, unless they say. */
  peer = "127.0.0.1";
  private handler: TransportHandler | undefined;
  private readonly open = new Set<FakeConnection>();
  private inFlight = 0;
  private closed = false;
  private onIdle: (() => void) | undefined;

  serve(handler: TransportHandler): void {
    this.handler = handler;
  }

  listen(port: number): Promise<{ port: number }> {
    return Promise.resolve({ port: port === 0 ? 1 : port });
  }

  connections(): Iterable<Connection> {
    return this.open;
  }

  get connectionCount(): number {
    return this.open.size;
  }

  close(): Promise<void> {
    this.closed = true;
    return new Promise((resolve) => {
      this.onIdle = resolve;
      this.idle();
    });
  }

  /** Sends a request as written: the target is never resolved, as a raw socket would send it. */
  async request(request: FakeRequest): Promise<FakeReply> {
    const handler = this.served();
    this.inFlight++;
    try {
      return await exchange(
        (wrapped, response) => {
          handler.request(wrapped, response);
        },
        request,
        this.peer,
      );
    } finally {
      this.inFlight--;
      this.idle();
    }
  }

  /**
   * As the global `fetch`, which a test can swap for it: the URL's host only
   * names the Host header, redirects are never followed, and only the
   * headers given are sent (no Accept-Encoding: bodies come as the server sent them).
   */
  async fetch(input: string | URL, init: RequestInit & { peer?: string } = {}): Promise<Response> {
    const url = new URL(input, "http://127.0.0.1");
    const built = new Request(url.href, init);
    const headers: Record<string, string> = { host: url.host };
    built.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const body = built.body ? new Uint8Array(await built.arrayBuffer()) : undefined;
    const reply = await this.request({
      method: built.method,
      url: `${url.pathname}${url.search}`,
      headers,
      ...(init.peer !== undefined && { peer: init.peer }),
      ...(body !== undefined && { body }),
    });
    return toResponse(reply, built.method);
  }

  /**
   * Opens a WebSocket to `url`, such as `/ws`. A refusal comes as an `error`
   * then a `close`, as from a `ws` client: "Unexpected server response: 429".
   */
  connect(
    url: string,
    options: { headers?: Record<string, string>; peer?: string; autoPong?: boolean } = {},
  ): FakeSocket {
    const handler = this.served();
    const client = new FakeSocket(options.autoPong ?? true);
    const headers: Record<string, string> = { host: "127.0.0.1", ...options.headers };
    const answer = handler.upgrade({
      method: "GET",
      url,
      header: (name) => headers[name],
      peer: options.peer ?? this.peer,
      body: () => Promise.resolve({ kind: "read", bytes: new Uint8Array() }),
    });
    if ("refuse" in answer) {
      setImmediate(() => {
        client.readyState = CLOSED;
        client.emit("error", new Error(`Unexpected server response: ${String(answer.refuse)}`));
        client.emit("close", 1006, Buffer.alloc(0));
      });
      return client;
    }
    const connection: FakeConnection = new FakeConnection(client, handler.maxPayloadBytes, () => {
      this.open.delete(connection);
      answer.released?.();
      this.idle();
    });
    client.server = connection;
    this.open.add(connection);
    // Open on the client's side first: whatever the server sends at once comes after.
    setImmediate(() => {
      if (client.readyState !== CONNECTING) return;
      client.readyState = OPEN;
      client.emit("open");
    });
    connection.attach(answer.accept(connection));
    return client;
  }

  private served(): TransportHandler {
    if (this.closed) throw new TypeError("fetch failed: the server is closed");
    if (!this.handler) throw new Error("the transport serves no server yet");
    return this.handler;
  }

  private idle(): void {
    if (this.closed && this.open.size === 0 && this.inFlight === 0) this.onIdle?.();
  }
}
