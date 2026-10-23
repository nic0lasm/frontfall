import { parseServerMessage, type ClientMessage, type ServerMessage } from "@frontfall/protocol";

const MAX_RETRY_DELAY_MS = 10_000;

/** WebSocket URL next to the page, so the game works under any path prefix. */
export function socketUrl(page: string): string {
  const url = new URL("ws", page);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.hash = "";
  url.search = "";
  return url.href;
}

export function retryDelay(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt);
}

export interface ConnectionEvents {
  onOpen(send: (message: ClientMessage) => void): void;
  onMessage(message: ServerMessage): void;
  onClose(retryInMs: number): void;
}

/** Keeps one connection open, reconnecting with backoff after every drop. */
export function connect(url: string, events: ConnectionEvents): void {
  let attempt = 0;

  const open = (): void => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      attempt = 0;
      events.onOpen((message) => {
        socket.send(JSON.stringify(message));
      });
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      const parsed = parseServerMessage(event.data);
      if (parsed.ok) events.onMessage(parsed.value);
    });
    socket.addEventListener("close", () => {
      const delay = retryDelay(attempt++);
      events.onClose(delay);
      setTimeout(open, delay);
    });
  };

  open();
}
