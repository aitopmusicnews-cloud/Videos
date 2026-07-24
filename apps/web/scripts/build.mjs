import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidebarPath = resolve(webRoot, "src/components/Sidebar.tsx");
const directorPath = resolve(webRoot, "src/components/AutoDirector.tsx");
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
            ? [current.vision.trim(), note].filter(Boolean).join("\\n")
            : current.vision;
          return { ...current, vision };
        }

        const description = note || name;
        const referenceLine = description
          ? kind + " reference: " + description
          : kind + " visual reference supplied";
        const mustInclude = [current.mustInclude.trim(), referenceLine]
          .filter(Boolean)
          .join("\\n");

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

const patchedDirector = replaceRequired(
  originalDirector,
  directorEffectAnchor,
  referenceListener,
  "Director reference chat listener",
);

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
  console.log("[web build] Connected reference chat to the Director session.");

  await run("tsc", ["--noEmit"]);
  await run("vite", ["build"]);
} finally {
  if (needsNormalization) {
    await writeFile(sidebarPath, originalSidebar, "utf8");
  }
  await writeFile(directorPath, originalDirector, "utf8");
}
