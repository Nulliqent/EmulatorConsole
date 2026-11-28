import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";

/** Why a run file could not be used: it is not there, or it is not a small regular file. */
export type SmallFileResult = { ok: true; text: string } | { ok: false; reason: "missing" | "unsafe" };

/**
 * Reads a small regular file. The Emulator's run files are written by another process, so a symlink (not followed), a
 * FIFO (opened non-blocking, so it can't hang), a device, a directory or a huge file is `unsafe`, and an absent one is
 * `missing`. The read loops until the end of the file, so a short read cannot cut the text; a file that grows past
 * `maxBytes` while being read is unsafe.
 */
export async function readSmallFileResult(file: string, maxBytes: number): Promise<SmallFileResult> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return { ok: false, reason: "unsafe" };
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(8192, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) return { ok: false, reason: "unsafe" };
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unsafe" };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Reads a small regular file, or returns null (see `readSmallFileResult`). */
export async function readSmallFile(file: string, maxBytes: number): Promise<string | null> {
  const result = await readSmallFileResult(file, maxBytes);
  return result.ok ? result.text : null;
}

/** The synchronous form of `readSmallFile`, for start-up. */
export function readSmallFileSync(file: string, maxBytes: number): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    return readFileSync(fd, { encoding: "utf8" }).slice(0, maxBytes);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
