import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Files served outside /assets/. Every other path is a client-side route and gets index.html. */
const ROOT_FILES = new Set(["/favicon.ico", "/favicon.svg"]);

export type StaticFile = { body: Buffer; type: string };

/** Reads a file only if its real path stays inside the real root, so a symlink cannot lead out. */
async function readInside(root: string, target: string): Promise<Buffer | null> {
  try {
    const [realRoot, real] = await Promise.all([realpath(root), realpath(target)]);
    if (!real.startsWith(realRoot + path.sep)) return null;
    return await readFile(real);
  } catch {
    return null;
  }
}

/** Serves the built UI. `root` must be absolute. A missing asset is a 404; any other path is the app shell. */
export async function readStatic(root: string, urlPath: string): Promise<StaticFile | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const normal = path.posix.normalize("/" + rel);
  if (normal.startsWith("/assets/") || ROOT_FILES.has(normal)) {
    const target = path.join(root, normal);
    const body = await readInside(root, target);
    return body ? { body, type: TYPES[path.extname(target)] ?? "application/octet-stream" } : null;
  }
  const body = await readInside(root, path.join(root, "index.html"));
  return body ? { body, type: TYPES[".html"] } : null;
}
