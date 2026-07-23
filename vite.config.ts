import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    strictPort: true,
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
  preview: {
    port: 3000,
    host: "0.0.0.0",
    strictPort: true,
  }
});

