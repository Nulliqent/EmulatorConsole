import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const servers = [createApp(config).listen(config.port, config.bindHost, () => {
  console.log(`Emulator Console on http://127.0.0.1:${config.port}`);
})];

// The Gateway (a later ticket) is a separate http.Server on config.gatewayPort, built and listened on here,
// and added to `servers` so it shuts down with the Console. Nothing listens on that port yet.

function shutdown() {
  for (const server of servers) server.close();
  for (const server of servers) server.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
