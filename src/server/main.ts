import { createApp } from "./app.js";
import { CallStore } from "./calls/store.js";
import { loadConfig } from "./config.js";
import { loadCertificate } from "./gateway/certificate.js";
import { Gateway } from "./gateway/gateway.js";
import { modelIndex } from "./model-index/index.js";
import { createMonitorFor } from "./monitor.js";

const config = loadConfig();
const monitor = createMonitorFor(config);
monitor.start();
// Build the operation table Find searches now, so the first search does not wait for it. A failure is retried on use.
void modelIndex(config.modelIndexDir)
  .then((index) => index.operationTable())
  .catch(() => {});

// The Gateway is its own server on its own port, built here from the same config. It records whenever the Console
// runs, whether or not a browser tab is open. A port in use is a state the Gateway page shows (B1), not a crash.
const store = new CallStore();
const certificate = loadCertificate(config.gatewayCertDir);
const gateway = new Gateway({ config, store, certificate });
// Calls after a restart belong to the new Emulator Run from the moment the monitor sees it.
monitor.onRestart((at) => store.startRun(at));
void gateway.listen().then((state) => {
  if (state === "listening") console.log(`Gateway on http://127.0.0.1:${config.gatewayPort} (plain HTTP and TLS)`);
  else console.error(`Gateway did not start: ${state === "port-in-use" ? `port ${config.gatewayPort} is in use` : "listen failed"}`);
});

const servers = [
  createApp(config, monitor, { store, gateway: () => ({ state: gateway.state, certificate: certificate.cert }) }).listen(config.port, config.bindHost, () => {
    console.log(`Emulator Console on http://127.0.0.1:${config.port}`);
  }),
  gateway,
];

function shutdown() {
  monitor.stop();
  for (const server of servers) server.close();
  for (const server of servers) server.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
