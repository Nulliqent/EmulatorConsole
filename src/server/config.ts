import path from "node:path";

export type Config = {
  /** Address the Console's HTTP server binds to. Containers bind 0.0.0.0; compose publishes on loopback only. */
  bindHost: string;
  /** Port the Console listens on, and the port a browser uses to reach it. */
  port: number;
  /** Port reserved for the Gateway (a later ticket). Nothing listens on it yet. */
  gatewayPort: number;
  /** Where to reach the Emulator. */
  emulatorHost: string;
  emulatorPort: number;
  /** TLS name to verify the Emulator's certificate against, when it differs from emulatorHost. */
  emulatorTlsServername?: string;
  /** The Emulator's home folder, holding `<port>/ca.pem` and `<port>/emulator_credentials`. */
  emulatorHome: string;
  /** Built UI files. */
  webRoot: string;
};

function intFrom(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    bindHost: env.CONSOLE_BIND ?? "127.0.0.1",
    port: intFrom(env.CONSOLE_PORT, 9298),
    gatewayPort: intFrom(env.GATEWAY_PORT, 9300),
    emulatorHost: env.EMULATOR_HOST ?? "127.0.0.1",
    emulatorPort: intFrom(env.EMULATOR_PORT, 9297),
    emulatorTlsServername: env.EMULATOR_TLS_SERVERNAME || undefined,
    emulatorHome: env.EMULATOR_HOME ?? path.join(env.HOME ?? "/", ".aws", "emulator"),
    webRoot: path.resolve(env.WEB_ROOT ?? path.join(import.meta.dirname, "..", "web")),
  };
}
