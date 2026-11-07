import type { Frame } from "@frontfall/protocol";

/** Headers of an answer. A list sends the header once per value, as for Set-Cookie. */
export type ReplyHeaders = Readonly<Record<string, string | number | readonly string[]>>;

/** What the body of a request read to its end gave. */
export type RequestBody =
  | { readonly kind: "read"; readonly bytes: Uint8Array }
  /** It passed the limit: nothing more is read. */
  | { readonly kind: "too_large" }
  /** The client went before the end. */
  | { readonly kind: "aborted" };

/** A request, HTTP or the start of a WebSocket, as the server sees it. */
export interface HttpRequest {
  readonly method: string;
  /**
   * The request target exactly as the client sent it, such as `/api/games?x=1`
   * or `//host/path`, never resolved against a host.
   */
  readonly url: string;
  /**
   * A header by its name in lower case, undefined when the request has none.
   * A header sent twice reads as its values joined with ", ".
   */
  header(name: string): string | undefined;
  /** The address of the peer, as the connection gives it: a reverse proxy, or the player. */
  readonly peer: string | undefined;
  /** Reads the body, at most `limit` bytes of it. A request without one reads as empty. */
  body(limit: number): Promise<RequestBody>;
}

/** The answer to one HTTP request, sent once. */
export interface HttpResponse {
  /**
   * Sends the status, the headers and the body at once. A body sent in answer
   * to HEAD is dropped by the transport, its length kept.
   */
  send(status: number, headers?: ReplyHeaders, body?: string | Uint8Array): void;
  /** Cuts the connection, after whatever was sent. */
  abort(): void;
}

/** One open WebSocket, from the server's side. */
export interface Connection {
  /** Whether frames may still be sent: false from the start of the close. */
  readonly open: boolean;
  /** Bytes sent and not yet handed to the network, as with a client that stopped reading. */
  readonly bufferedAmount: number;
  /** Sends one frame: a string as text, bytes as binary. `sent` runs once it is handed to the network. */
  send(frame: Frame, sent?: () => void): void;
  ping(): void;
  /** Closes with a code and a reason, through the closing handshake. */
  close(code: number, reason: string): void;
  /** Drops the connection at once, without a handshake. */
  terminate(): void;
}

/** What the server does with what happens on a connection it accepted. */
export interface ConnectionEvents {
  message(frame: Frame): void;
  pong(): void;
  /**
   * A frame the transport refused: larger than `maxPayloadBytes`, or
   * breaking the protocol. The transport closes the connection itself.
   */
  error(kind: "oversized" | "invalid"): void;
  /** The connection is closed, with the code of the close frame, or 1006 without one. */
  close(code: number): void;
}

/** The server's answer to a request to open a WebSocket. */
export type UpgradeAnswer =
  /** Refused with a bare HTTP status, before any WebSocket opens. */
  | { readonly refuse: 403 | 429 }
  | {
      /** Called with the connection once the handshake is done. */
      readonly accept: (connection: Connection) => ConnectionEvents;
      /**
       * Called once the underlying connection closes, whether the handshake
       * went through or not, so a slot taken for it is never kept.
       */
      readonly released?: () => void;
    };

/** What a transport asks of the server it carries. */
export interface TransportHandler {
  /** Largest frame a client may send; the transport refuses larger ones. */
  readonly maxPayloadBytes: number;
  /** Answers an HTTP request, now or later, through `response`. */
  request(request: HttpRequest, response: HttpResponse): void;
  /** Answers a request to open a WebSocket on the same port. */
  upgrade(request: HttpRequest): UpgradeAnswer;
}

/**
 * The network under the server: HTTP and WebSocket on one port. The server
 * is written against this, so a test can run it without a socket and a
 * runtime can bring its own.
 */
export interface Transport {
  /** Hands the transport the server it carries; called once, before `listen`. */
  serve(handler: TransportHandler): void;
  /** Starts taking connections on `port` of `host` (every address when unset); 0 picks a free port. */
  listen(port: number, host?: string): Promise<{ port: number }>;
  /** The WebSockets whose handshake is done and that are not closed yet. */
  connections(): Iterable<Connection>;
  readonly connectionCount: number;
  /**
   * Stops taking connections, and resolves once every connection, HTTP or
   * WebSocket, has ended.
   */
  close(): Promise<void>;
}
