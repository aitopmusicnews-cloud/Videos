import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        secure: false,
        ws: true,
        xfwd: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if (res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Backend API is starting up or temporarily unreachable. Please retry in a moment." }));
            }
          });
        },
      },
      "/storage": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        secure: false,
        xfwd: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if (res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Storage service is starting up or temporarily unreachable." }));
            }
          });
        },
      },
    },
  },
});

