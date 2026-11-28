import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
// Written by this checkout's `scripts/e2e.sh up` and removed by `down`. Without it this run did not start the
// stack, so the tests leave it alone.
const MARK = path.join(ROOT, ".aws", "e2e", ".started-here");

function compose(...args: string[]) {
  if (!existsSync(MARK)) {
    throw new Error("This checkout did not start the e2e stack; refusing to stop or start its Emulator.");
  }
  execFileSync("docker", ["compose", "--env-file", ".env.e2e", "-p", "console-e2e", ...args], {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, HOST_UID: String(process.getuid?.() ?? 1000), HOST_GID: String(process.getgid?.() ?? 1000) },
  });
}

export const stopEmulator = () => compose("stop", "emulator");
export const startEmulator = () => compose("start", "emulator");
export const restartEmulator = () => compose("restart", "emulator");
export const restartConsole = () => compose("restart", "console");
