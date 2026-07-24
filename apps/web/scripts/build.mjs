import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchDirectorStatus } from "./director-status-patch.mjs";
import { patchDirectorEditing } from "./director-edit-patch.mjs";
import {
  patchDirectorAgentRuntime,
  patchDirectorAgentComponent,
  patchDirectorReferenceChat,
} from "./director-agent-runtime-patch.mjs";
import { patchDirectorSectionApprovals } from "./director-section-approval-patch.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidebarPath = resolve(webRoot, "src/components/Sidebar.tsx");
const directorPath = resolve(webRoot, "src/components/AutoDirector.tsx");
const agentPath = resolve(webRoot, "src/components/LtxDirectorAgent.tsx");
const referenceChatPath = resolve(webRoot, "src/components/DirectorReferenceChat.tsx");
const apiPath = resolve(webRoot, "src/lib/api.ts");
const schedulerPath = resolve(webRoot, "src/lib/scheduler.ts");
const inferredDeclaration = "  let percent = current.percent;";
const numericDeclaration = "  let percent: number = current.percent;";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectRun(new Error(`${command} stopped after ${signal}`));
      } else if (code !== 0) {
        rejectRun(new Error(`${command} exited with code ${code}`));
      } else {
        resolveRun();
      }
    });
  });
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`Could not apply ${label}; expected source text was not found.`);
  }
  return source.replace(from, to);
}

const originalSidebar = await readFile(sidebarPath, "utf8");
const originalDirector = await readFile(directorPath, "utf8");
const originalAgent = await readFile(agentPath, "utf8");
const originalReferenceChat = await readFile(referenceChatPath, "utf8");
const originalApi = await readFile(apiPath, "utf8");
const originalScheduler = await readFile(schedulerPath, "utf8");
const needsNormalization = originalSidebar.includes(inferredDeclaration);

if (!needsNormalization && !originalSidebar.includes(numericDeclaration)) {
  throw new Error("Could not find the LipDub progress percentage declaration in Sidebar.tsx");
}

const directorEffectAnchor = `  useEffect(() => {
    if (!songId || !analysis || clips.length === 0) {`;

const referenceListener = `  useEffect(() => {
    const receiveReference = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?: "character" | "style" | "location" | "shot" | "note";
        media?: "image" | "video" | "note";
        name?: string;
        url?: string;
        sourceUrl?: string;
        note?: string;
      }>).detail;
      if (!detail) return;

      const kind = detail.kind ?? "style";
      const note = String(detail.note ?? "").trim();
      const name = String(detail.name ?? "reference").trim();
      const anchorUrl = detail.url;

      if (anchorUrl) addLookbook(anchorUrl);
      if (kind === "character" && anchorUrl) setCharacter(anchorUrl);

      setSession((current) => {
        if (!current) return current;
        if (kind === "note") {
          const vision = note
            ? [current.vision.trim(), note].filter(Boolean).join("\n")
            : current.vision;
          return { ...current, vision };
        }

        const description = note || name;
        const referenceLine = description
          ? kind + " reference: " + description
          : kind + " visual reference supplied";
        const mustInclude = [current.mustInclude.trim(), referenceLine]
          .filter(Boolean)
          .join("\n");

        return {
          ...current,
          mustInclude,
          characterUrl: kind === "character" && anchorUrl ? anchorUrl : current.characterUrl,
          characterApproved: kind === "character" && anchorUrl ? false : current.characterApproved,
        };
      });

      setDirectorError(null);
      setOpen(true);
    };

    window.addEventListener("mvs-director-reference", receiveReference as EventListener);
    return () => window.removeEventListener("mvs-director-reference", receiveReference as EventListener);
  }, [addLookbook, setCharacter]);

${directorEffectAnchor}`;

let patchedDirector = replaceRequired(
  originalDirector,
  directorEffectAnchor,
  referenceListener,
  "Director reference chat listener",
);
patchedDirector = patchDirectorStatus(patchedDirector, replaceRequired);
patchedDirector = patchDirectorEditing(patchedDirector, replaceRequired);

const oldApiErrorMessage = `    const msg = parsed?.error ?? text;
    throw new ApiError(res.status, msg, parsed?.rateLimited === true);`;

const safeApiErrorMessage = `    const isHtml = /<!doctype|<html/i.test(text.slice(0, 300));
    const msg = parsed?.error ?? (isHtml
      ? (res.status >= 500
          ? "The Render service is temporarily unavailable. Please try again."
          : "The server returned an HTML error page instead of JSON.")
      : text.slice(0, 500));
    throw new ApiError(res.status, msg, parsed?.rateLimited === true);`;

const oldSliceAudio = `export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/audio/slice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioUrl, start, end }),
    })
  );
}`;

const retryingSliceAudio = `export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {
  const request = () => fetch("/api/audio/slice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioUrl, start, end }),
  });

  let response = await request();
  if (response.status >= 500) {
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 2500));
    response = await request();
  }
  return jsonOrThrow(response);
}`;

let patchedApi = replaceRequired(
  originalApi,
  oldApiErrorMessage,
  safeApiErrorMessage,
  "safe HTML API error message",
);
patchedApi = replaceRequired(
  patchedApi,
  oldSliceAudio,
  retryingSliceAudio,
  "transient promo audio retry",
);

const patchedScheduler = patchDirectorAgentRuntime(originalScheduler, replaceRequired);
const patchedAgent = patchDirectorSectionApprovals(
  patchDirectorAgentComponent(originalAgent, replaceRequired),
  replaceRequired,
);
const patchedReferenceChat = patchDirectorReferenceChat(originalReferenceChat, replaceRequired);

try {
  if (needsNormalization) {
    await writeFile(
      sidebarPath,
      originalSidebar.replace(inferredDeclaration, numericDeclaration),
      "utf8",
    );
    console.log("[web build] Normalized LipDub progress percentage to number.");
  }

  await writeFile(directorPath, patchedDirector, "utf8");
  console.log("[web build] Kept legacy Director source build-compatible for saved sessions.");

  await writeFile(apiPath, patchedApi, "utf8");
  console.log("[web build] Added transient Render retry and safe API error messages.");

  await writeFile(schedulerPath, patchedScheduler, "utf8");
  await writeFile(agentPath, patchedAgent, "utf8");
  await writeFile(referenceChatPath, patchedReferenceChat, "utf8");
  console.log("[web build] Enforced strict LTX conditioning and sequential treatment, character, and analyzed-section approvals.");

  await run("tsc", ["--noEmit"]);
  await run("vite", ["build"]);
} finally {
  if (needsNormalization) {
    await writeFile(sidebarPath, originalSidebar, "utf8");
  }
  await writeFile(directorPath, originalDirector, "utf8");
  await writeFile(agentPath, originalAgent, "utf8");
  await writeFile(referenceChatPath, originalReferenceChat, "utf8");
  await writeFile(apiPath, originalApi, "utf8");
  await writeFile(schedulerPath, originalScheduler, "utf8");
}
