import { spawn } from "node:child_process";

// Force PORT=3001 for API backend so system environment variable PORT doesn't override 3001
const apiEnv = { ...process.env, PORT: "3001" };

console.log("[MVS] Starting API server on port 3001...");
const api = spawn("npx", ["tsx", "watch", "--env-file-if-exists=.env", "apps/api/src/server.ts"], {
  stdio: "inherit",
  shell: true,
  env: apiEnv,
});

console.log("[MVS] Starting Vite Web server on port 3000...");
const web = spawn("npx", ["vite", "--config", "apps/web/vite.config.ts", "apps/web"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

const cleanup = () => {
  try {
    api.kill();
    web.kill();
  } catch (_) {}
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
