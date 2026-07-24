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

let patchedDirector = originalDirector;
patchedDirector = replaceRequired(
  patchedDirector,
  '  const [productionNote, setProductionNote] = useState<string | null>(null);',
  '  const [productionNote, setProductionNote] = useState<string | null>(null);\n  const [directorError, setDirectorError] = useState<string | null>(null);',
  "Director inline error state",
);
patchedDirector = replaceRequired(
  patchedDirector,
  '  const generateCharacter = async () => {\n    setBusy("Generating character reference…");',
  '  const generateCharacter = async () => {\n    setDirectorError(null);\n    setBusy("Generating character reference…");',
  "Director character error reset",
);
patchedDirector = replaceRequired(
  patchedDirector,
  `      const result = await startTextToImage({
        promptText: session.characterPrompt,
        ratio: "16:9",
        model: "sdxl",
      }) as unknown as { imageUrl?: string; url?: string };
      const imageUrl = result.imageUrl ?? result.url;`,
  `      let result: { imageUrl?: string; url?: string } | null = null;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          result = await startTextToImage({
            promptText: session.characterPrompt,
            ratio: "16:9",
            model: "sdxl",
          }) as unknown as { imageUrl?: string; url?: string };
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            setBusy("Image service is waking up. Retrying character generation…");
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));
          }
        }
      }
      if (!result) {
        throw lastError instanceof Error
          ? lastError
          : new Error(String(lastError || "Character generation failed"));
      }
      const imageUrl = result.imageUrl ?? result.url;`,
  "Director character cold-start retry",
);
patchedDirector = replaceRequired(
  patchedDirector,
  `    } catch (error) {
      toast.error(\`Character generation failed: \${error instanceof Error ? error.message : String(error)}\`);
    } finally {`,
  `    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDirectorError(message);
      toast.error(\`Character generation failed: \${message}\`);
    } finally {`,
  "Director character inline error capture",
);
patchedDirector = replaceRequired(
  patchedDirector,
  '              {session.characterUrl && <img src={session.characterUrl} alt="Generated artist reference" style={heroImageStyle} />}',
  `              {session.characterUrl && (
                <img
                  src={session.characterUrl}
                  alt="Generated artist reference"
                  style={heroImageStyle}
                  onError={() => setDirectorError("The character was generated, but the image could not be displayed. Use Regenerate character to try again.")}
                />
              )}
              {directorError && (
                <div style={{ marginTop: 14, padding: 13, borderRadius: 10, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.36)", color: "#fecaca", lineHeight: 1.45 }}>
                  <strong>Character generation failed</strong>
                  <div style={{ marginTop: 5 }}>{directorError}</div>
                </div>
              )}`,
  "Director visible character error",
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
  console.log("[web build] Added visible Director character errors and cold-start retry.");

  await run("tsc", ["--noEmit"]);
  await run("vite", ["build"]);
} finally {
  if (needsNormalization) {
    await writeFile(sidebarPath, originalSidebar, "utf8");
  }
  await writeFile(directorPath, originalDirector, "utf8");
}
