import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

export interface StaticFile {
  body: Buffer;
  contentType: string;
}

/**
 * Resolves a request path to a file inside `root`, or undefined when the file
 * does not exist or the path tries to leave the root. "/" serves index.html.
 */
export async function loadStaticFile(
  root: string,
  requestPath: string,
): Promise<StaticFile | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;

  const relative = normalize(decoded === "/" ? "/index.html" : decoded);
  const absolute = join(root, relative);
  if (!absolute.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined;

  try {
    if (!(await stat(absolute)).isFile()) return undefined;
    return {
      body: await readFile(absolute),
      contentType: CONTENT_TYPES[extname(absolute)] ?? "application/octet-stream",
    };
  } catch {
    return undefined;
  }
}
