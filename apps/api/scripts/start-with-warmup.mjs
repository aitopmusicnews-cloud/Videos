import { spawn } from "node:child_process";

const server = spawn(process.execPath, ["dist/server.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function warmLipDub() {
  const url = process.env.MODAL_LIPSYNC_URL?.trim();
  if (!url) {
    console.log("[LipDub Warmup] MODAL_LIPSYNC_URL is not configured; skipping.");
    return;
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.MODAL_KEY && process.env.MODAL_SECRET) {
    headers["Modal-Key"] = process.env.MODAL_KEY;
    headers["Modal-Secret"] = process.env.MODAL_SECRET;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "warmup", source: "render-startup" }),
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `${response.status} ${response.statusText}`);
      }

      const result = await response.json().catch(() => ({}));
      console.log(
        `[LipDub Warmup] Modal accepted startup warm-up${result.call_id ? ` (${result.call_id})` : ""}.`,
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[LipDub Warmup] Attempt ${attempt}/3 failed: ${message}`);
      if (attempt < 3) await sleep(5_000);
    }
  }

  console.warn("[LipDub Warmup] Startup continues; LipDub will cold-start on first use.");
}

// Let the API bind its port first, then start Modal in the background. The web
// service remains responsive while the A100 container and model cache warm up.
const warmupTimer = setTimeout(() => {
  void warmLipDub();
}, 1_500);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    clearTimeout(warmupTimer);
    if (!server.killed) server.kill(signal);
  });
}

server.on("error", (error) => {
  console.error("[API Startup] Could not launch dist/server.js:", error);
  process.exitCode = 1;
});

server.on("exit", (code, signal) => {
  clearTimeout(warmupTimer);
  if (signal) {
    console.log(`[API Startup] Server exited after ${signal}.`);
    process.exitCode = 0;
  } else {
    process.exitCode = code ?? 0;
  }
});
