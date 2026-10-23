import { randomInt } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { parseClientMessage, TICK_RATE, type ServerMessage } from "@frontfall/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { Lobby } from "./lobby.ts";
import { isAllowedOrigin } from "./origin.ts";
import { loadStaticFile } from "./static-files.ts";

const port = Number(process.env.PORT ?? 8080);
const allowedOrigin = process.env.FRONTFALL_ORIGINE;
const staticRoot =
  process.env.FRONTFALL_STATIC ?? fileURLToPath(new URL("../../client/dist", import.meta.url));

/** Cloudflare drops a silent connection after 100 s. */
const PING_INTERVAL_MS = 25_000;
const SHUTDOWN_GRACE_MS = 5_000;

interface Room {
  lobby: Lobby;
  sockets: Set<WebSocket>;
  timer: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();
const alive = new WeakSet<WebSocket>();

const http = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }
  void loadStaticFile(staticRoot, path).then((file) => {
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": file.contentType });
    if (request.method === "HEAD") response.end();
    else response.end(file.body);
  });
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

http.on("upgrade", (request, socket, head) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path !== "/ws" || !isAllowedOrigin(request.headers.origin, allowedOrigin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    sockets.emit("connection", ws, request);
  });
});

function decode(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString("utf8");
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function openRoom(name: string): Room {
  const room: Room = {
    lobby: new Lobby(randomInt(2 ** 31)),
    sockets: new Set(),
    timer: setInterval(() => {
      const message = JSON.stringify({ type: "turn", turn: room.lobby.closeTurn() });
      for (const socket of room.sockets) socket.send(message);
    }, 1000 / TICK_RATE),
  };
  rooms.set(name, room);
  return room;
}

sockets.on("connection", (socket) => {
  let room: Room | undefined;
  let player: string | undefined;
  alive.add(socket);

  socket.on("pong", () => alive.add(socket));

  socket.on("message", (data) => {
    const parsed = parseClientMessage(decode(data));
    if (!parsed.ok) {
      send(socket, { type: "error", message: parsed.error });
      return;
    }
    const message = parsed.value;
    if (message.type === "join") {
      if (room) return;
      room = rooms.get(message.lobby) ?? openRoom(message.lobby);
      player = room.lobby.join();
      room.sockets.add(socket);
      send(socket, { type: "joined", player, seed: room.lobby.seed });
    } else if (room && player) {
      room.lobby.submit(player, message.intent);
    }
  });

  socket.on("close", () => {
    if (!room || !player) return;
    room.lobby.leave(player);
    room.sockets.delete(socket);
    if (room.lobby.playerCount === 0) {
      clearInterval(room.timer);
      for (const [name, candidate] of rooms) if (candidate === room) rooms.delete(name);
    }
  });
});

const heartbeat = setInterval(() => {
  for (const socket of sockets.clients) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, PING_INTERVAL_MS);

function shutdown(): void {
  clearInterval(heartbeat);
  for (const room of rooms.values()) clearInterval(room.timer);
  for (const socket of sockets.clients) {
    send(socket, { type: "error", message: "server restarting" });
    socket.close(1012, "server restarting");
  }
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

http.listen(port, () => {
  console.log(`Frontfall listening on http://localhost:${String(port)}`);
});
