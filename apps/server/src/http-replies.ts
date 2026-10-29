import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadStaticFile } from "./static-files.ts";

/**
 * Headers of every page and file the server sends. The policy is the one the
 * game is deployed behind, without a host: a server run on its own, at any
 * address, gets the same protection. A proxy may replace it.
 */
export const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
} as const;

/**
 * A file of the built client, gzipped for a browser that takes it, with an
 * ETag and the cache headers of its kind, or 404.
 */
export function serveStatic(
  root: string,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  void loadStaticFile(root, path).then((file) => {
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const gzip = file.gzip && acceptsGzip(request) ? file.gzip : undefined;
    const caching = {
      etag: file.etag,
      // Built assets carry a content hash in their name; the page itself must stay fresh.
      "cache-control": path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
    if (matchesEtag(request.headers["if-none-match"], file.etag)) {
      response.writeHead(304, caching).end();
      return;
    }
    response.writeHead(200, {
      ...caching,
      "content-type": file.contentType,
      ...SECURITY_HEADERS,
      "content-length": (gzip ?? file.body).length,
      ...(file.gzip && { vary: "Accept-Encoding" }),
      ...(gzip && { "content-encoding": "gzip" }),
    });
    if (request.method === "HEAD") response.end();
    else response.end(gzip ?? file.body);
  });
}

/** If-None-Match lists tags, which proxies may have weakened; any match will do. */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => bare(tag) === bare(etag) || tag.trim() === "*");
}

function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers["accept-encoding"];
  return typeof header === "string" && /(^|[\s,])gzip(?!;\s*q=0(\.0*)?(\s*,|$))/i.test(header);
}

export function sendJson(response: ServerResponse, body: unknown, caching = "no-store"): void {
  response
    .writeHead(200, { "content-type": "application/json", "cache-control": caching })
    .end(JSON.stringify(body));
}

/** A JSON body and its ETag, worked out once for every request that gets it. */
export interface CachedJson {
  readonly text: string;
  readonly etag: string;
}

export function cachedJson(body: unknown): CachedJson {
  const text = JSON.stringify(body);
  return { text, etag: `"${createHash("sha1").update(text).digest("base64url").slice(0, 16)}"` };
}

/**
 * A JSON answer with an ETag, so that a menu asking every few seconds gets
 * an empty 304 while nothing changed.
 */
export function sendCachedJson(
  request: IncomingMessage,
  response: ServerResponse,
  body: CachedJson,
): void {
  const { text, etag } = body;
  const headers = { etag, "cache-control": "no-cache" };
  if (matchesEtag(request.headers["if-none-match"], etag)) {
    response.writeHead(304, headers).end();
    return;
  }
  response.writeHead(200, { ...headers, "content-type": "application/json" }).end(text);
}
