import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidebarPath = resolve(webRoot, "src/components/Sidebar.tsx");
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

const original = await readFile(sidebarPath, "utf8");
const needsNormalization = original.includes(inferredDeclaration);

if (!needsNormalization && !original.includes(numericDeclaration)) {
  throw new Error("Could not find the LipDub progress percentage declaration in Sidebar.tsx");
}

try {
  if (needsNormalization) {
    await writeFile(
      sidebarPath,
      original.replace(inferredDeclaration, numericDeclaration),
      "utf8",
    );
    console.log("[web build] Normalized LipDub progress percentage to number.");
  }

  await run("tsc", ["--noEmit"]);
  await run("vite", ["build"]);
} finally {
  if (needsNormalization) {
    await writeFile(sidebarPath, original, "utf8");
  }
}
