import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CONSOLE = "http://127.0.0.1:9298";
const webRoot = path.resolve(import.meta.dirname, "src/web");

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    // The dev server must never serve the Emulator's run files (ca.pem, emulator_credentials) through /@fs.
    fs: {
      allow: [webRoot, path.resolve(import.meta.dirname, "src/shared"), path.resolve(import.meta.dirname, "node_modules")],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.aws/**", "**/emulator_credentials"],
    },
    proxy: {
      "/api": {
        target: CONSOLE,
        // Rewrites Host to the Console's own. The Console's guard allow list does not include the Vite port.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", CONSOLE));
        },
      },
    },
  },
});
