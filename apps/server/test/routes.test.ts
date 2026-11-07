import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../src/server.ts";
import { FakeTransport } from "./support/fake-transport.ts";

/**
 * Which route answers a request depends on the order of the checks, not only on
 * the path: /healthz and /api/usage answer any method, the admin routes only a
 * request from inside the container, and the method check comes after them.
 * This pins the status of every path and method, from the container and from outside.
 */
const PATHS = [
  "/healthz",
  "/admin/maintenance",
  "/admin/reports",
  "/admin/bans",
  "/admin/errors",
  "/admin/other",
  "/api/me",
  "/api/usage",
  "/api/games",
  "/api/status",
  "/status",
  "/api/stats",
  "/metrics",
  "/index.html",
  "/missing",
  "/auth/discord",
];
const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE"];

let staticRoot: string;
let server: GameServer | undefined;

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-routes-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(staticRoot, { recursive: true, force: true });
});

/** `METHOD path` and the status it gets, one line per request. */
async function statuses(peer: string): Promise<string[]> {
  const fake = new FakeTransport();
  server = createGameServer({ staticRoot, version: "abc123", drainMs: 0, transport: fake });
  await server.listen(0);
  const lines: string[] = [];
  for (const path of PATHS) {
    for (const method of METHODS) {
      const reply = await fake.request({
        method,
        url: path,
        headers: { host: "127.0.0.1" },
        peer,
      });
      lines.push(`${method} ${path} ${String(reply.status)}`);
    }
  }
  return lines;
}

const INSIDE = [
  "GET /healthz 200",
  "HEAD /healthz 200",
  "POST /healthz 200",
  "PUT /healthz 200",
  "DELETE /healthz 200",
  "GET /admin/maintenance 400",
  "HEAD /admin/maintenance 400",
  "POST /admin/maintenance 200",
  "PUT /admin/maintenance 400",
  "DELETE /admin/maintenance 400",
  "GET /admin/reports 200",
  "HEAD /admin/reports 400",
  "POST /admin/reports 400",
  "PUT /admin/reports 400",
  "DELETE /admin/reports 400",
  "GET /admin/bans 200",
  "HEAD /admin/bans 400",
  "POST /admin/bans 200",
  "PUT /admin/bans 400",
  "DELETE /admin/bans 400",
  "GET /admin/errors 200",
  "HEAD /admin/errors 400",
  "POST /admin/errors 400",
  "PUT /admin/errors 400",
  "DELETE /admin/errors 400",
  "GET /admin/other 404",
  "HEAD /admin/other 404",
  "POST /admin/other 404",
  "PUT /admin/other 404",
  "DELETE /admin/other 404",
  "GET /api/me 200",
  "HEAD /api/me 200",
  "POST /api/me 405",
  "PUT /api/me 405",
  "DELETE /api/me 405",
  "GET /api/usage 405",
  "HEAD /api/usage 405",
  "POST /api/usage 415",
  "PUT /api/usage 405",
  "DELETE /api/usage 405",
  "GET /api/games 200",
  "HEAD /api/games 200",
  "POST /api/games 405",
  "PUT /api/games 405",
  "DELETE /api/games 405",
  "GET /api/status 200",
  "HEAD /api/status 200",
  "POST /api/status 405",
  "PUT /api/status 405",
  "DELETE /api/status 405",
  "GET /status 200",
  "HEAD /status 200",
  "POST /status 405",
  "PUT /status 405",
  "DELETE /status 405",
  "GET /api/stats 200",
  "HEAD /api/stats 200",
  "POST /api/stats 405",
  "PUT /api/stats 405",
  "DELETE /api/stats 405",
  "GET /metrics 200",
  "HEAD /metrics 200",
  "POST /metrics 405",
  "PUT /metrics 405",
  "DELETE /metrics 405",
  "GET /index.html 200",
  "HEAD /index.html 200",
  "POST /index.html 405",
  "PUT /index.html 405",
  "DELETE /index.html 405",
  "GET /missing 404",
  "HEAD /missing 404",
  "POST /missing 405",
  "PUT /missing 405",
  "DELETE /missing 405",
  "GET /auth/discord 404",
  "HEAD /auth/discord 404",
  "POST /auth/discord 405",
  "PUT /auth/discord 405",
  "DELETE /auth/discord 405",
];

const OUTSIDE = [
  "GET /healthz 200",
  "HEAD /healthz 200",
  "POST /healthz 200",
  "PUT /healthz 200",
  "DELETE /healthz 200",
  "GET /admin/maintenance 404",
  "HEAD /admin/maintenance 404",
  "POST /admin/maintenance 404",
  "PUT /admin/maintenance 404",
  "DELETE /admin/maintenance 404",
  "GET /admin/reports 404",
  "HEAD /admin/reports 404",
  "POST /admin/reports 404",
  "PUT /admin/reports 404",
  "DELETE /admin/reports 404",
  "GET /admin/bans 404",
  "HEAD /admin/bans 404",
  "POST /admin/bans 404",
  "PUT /admin/bans 404",
  "DELETE /admin/bans 404",
  "GET /admin/errors 404",
  "HEAD /admin/errors 404",
  "POST /admin/errors 404",
  "PUT /admin/errors 404",
  "DELETE /admin/errors 404",
  "GET /admin/other 404",
  "HEAD /admin/other 404",
  "POST /admin/other 404",
  "PUT /admin/other 404",
  "DELETE /admin/other 404",
  "GET /api/me 200",
  "HEAD /api/me 200",
  "POST /api/me 405",
  "PUT /api/me 405",
  "DELETE /api/me 405",
  "GET /api/usage 405",
  "HEAD /api/usage 405",
  "POST /api/usage 415",
  "PUT /api/usage 405",
  "DELETE /api/usage 405",
  "GET /api/games 200",
  "HEAD /api/games 200",
  "POST /api/games 405",
  "PUT /api/games 405",
  "DELETE /api/games 405",
  "GET /api/status 200",
  "HEAD /api/status 200",
  "POST /api/status 405",
  "PUT /api/status 405",
  "DELETE /api/status 405",
  "GET /status 200",
  "HEAD /status 200",
  "POST /status 405",
  "PUT /status 405",
  "DELETE /status 405",
  "GET /api/stats 200",
  "HEAD /api/stats 200",
  "POST /api/stats 405",
  "PUT /api/stats 405",
  "DELETE /api/stats 405",
  "GET /metrics 404",
  "HEAD /metrics 404",
  "POST /metrics 405",
  "PUT /metrics 405",
  "DELETE /metrics 405",
  "GET /index.html 200",
  "HEAD /index.html 200",
  "POST /index.html 405",
  "PUT /index.html 405",
  "DELETE /index.html 405",
  "GET /missing 404",
  "HEAD /missing 404",
  "POST /missing 405",
  "PUT /missing 405",
  "DELETE /missing 405",
  "GET /auth/discord 404",
  "HEAD /auth/discord 404",
  "POST /auth/discord 405",
  "PUT /auth/discord 405",
  "DELETE /auth/discord 405",
];

describe("routes", () => {
  it("answers each path and method from inside the container as pinned", async () => {
    expect(await statuses("127.0.0.1")).toEqual(INSIDE);
  });

  it("answers each path and method from outside as pinned", async () => {
    expect(await statuses("203.0.113.9")).toEqual(OUTSIDE);
  });
});
