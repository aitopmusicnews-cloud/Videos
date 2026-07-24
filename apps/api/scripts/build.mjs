import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(apiRoot, "src/server.ts");
const modalAiPath = resolve(apiRoot, "src/modalAI.ts");
const directorAgentPath = resolve(apiRoot, "src/director_agent.ts");

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: apiRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`${command} stopped after ${signal}`));
      else if (code !== 0) rejectRun(new Error(`${command} exited with code ${code}`));
      else resolveRun();
    });
  });
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`Could not apply ${label}; expected source text was not found.`);
  }
  return source.replace(from, to);
}

const originalServer = await readFile(serverPath, "utf8");
const originalModalAi = await readFile(modalAiPath, "utf8");
const originalDirectorAgent = await readFile(directorAgentPath, "utf8");

let patchedServer = replaceRequired(
  originalServer,
  'import { config } from "./config.js";',
  'import { config } from "./config.js";\nimport { createDirectorPlan } from "./director_agent.js";',
  "Director agent server import",
);

const generationAnchor = "// Generation primitives ------------------------------------------------";
const directorRoute = `// LTX Director Agent ----------------------------------------------------

app.post("/api/director/plan", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
  try {
    return reply.send(await createDirectorPlan(req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof z.ZodError
      ? 400
      : message.includes("GEMINI_API_KEY")
        ? 503
        : message.includes("Character conditioning") || message.includes("character reference")
          ? 409
          : 500;
    req.log.error({ err: error }, "LTX Director Agent failed");
    return reply.code(status).send({ error: message });
  }
});

${generationAnchor}`;
patchedServer = replaceRequired(
  patchedServer,
  generationAnchor,
  directorRoute,
  "Director agent API route",
);

let patchedModalAi = replaceRequired(
  originalModalAi,
  `  const duration = Math.min(5, Math.max(1, Number(req.duration ?? 5)));
  const initImageUrl = req.promptImage ?? req.imageUrl;
  const jobId = \`job_\${Date.now()}_\${Math.random().toString(36).slice(2, 9)}\`;`,
  `  const duration = Math.min(5, Math.max(1, Number(req.duration ?? 5)));
  const initImageUrl = req.promptImage ?? req.imageUrl;
  const characterRequired = Boolean(
    (req as ImageToVideoRequest & { characterRequired?: boolean; requiresCharacter?: boolean }).characterRequired ??
    (req as ImageToVideoRequest & { characterRequired?: boolean; requiresCharacter?: boolean }).requiresCharacter
  );
  if (characterRequired && !initImageUrl) {
    throw new Error("Character conditioning is required. LTX generation was not started because no character image was attached.");
  }
  const jobId = \`job_\${Date.now()}_\${Math.random().toString(36).slice(2, 9)}\`;`,
  "strict character condition validation",
);

patchedModalAi = replaceRequired(
  patchedModalAi,
  `        init_image_url: initImageUrl || undefined,
        job_id: jobId,`,
  `        init_image_url: initImageUrl || undefined,
        character_required: characterRequired,
        job_id: jobId,`,
  "character requirement Modal payload",
);

let patchedDirectorAgent = replaceRequired(
  originalDirectorAgent,
  `      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 32768,
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: RESPONSE_SCHEMA,
          },
        },
      },`,
  `      generationConfig: {
        maxOutputTokens: 16384,
        responseFormat: {
          text: {
            mimeType: "APPLICATION_JSON",
          },
        },
      },`,
  "Gemini JSON mode without server-side schema",
);

patchedDirectorAgent = replaceRequired(
  patchedDirectorAgent,
  `  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {
      // Keep the original response text.
    }
    throw new Error(\`Gemini Director failed: \${message.slice(0, 800)}\`);
  }`,
  `  if (!response.ok) {
    let message = text;
    try {
      const parsedError = JSON.parse(text)?.error;
      const details = parsedError?.details ? \` Details: \${JSON.stringify(parsedError.details)}\` : "";
      message = \`\${parsedError?.message ?? text}\${details}\`;
    } catch {
      // Keep the original response text.
    }
    throw new Error(\`Gemini Director failed: \${message.slice(0, 1600)}\`);
  }`,
  "detailed Gemini API errors",
);

try {
  await writeFile(serverPath, patchedServer, "utf8");
  await writeFile(modalAiPath, patchedModalAi, "utf8");
  await writeFile(directorAgentPath, patchedDirectorAgent, "utf8");
  console.log("[api build] Wired Gemini LTX Director route, JSON mode with app validation, and strict character conditioning.");
  await run("tsc", ["-p", "tsconfig.json"]);
} finally {
  await writeFile(serverPath, originalServer, "utf8");
  await writeFile(modalAiPath, originalModalAi, "utf8");
  await writeFile(directorAgentPath, originalDirectorAgent, "utf8");
}
