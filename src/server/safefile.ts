import { constants } from "node:fs";
import { open } from "node:fs/promises";

/**
 * Reads a small regular file, or returns null. The Emulator's run files are written by another process, so a
 * symlink, a FIFO (opened non-blocking, so it can't hang the monitor), a device, a directory or a huge file is
 * treated as missing rather than followed or read.
 */
export async function readSmallFile(file: string, maxBytes: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    return (await handle.readFile({ encoding: "utf8" })).slice(0, maxBytes);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
