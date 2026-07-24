import { copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { config } from "./config.js";
import { ensureDir, playableUrl, storage } from "./storage.js";
import { resolveLocalPath } from "./paths.js";
import type { ProjectMeta, SavedProject } from "@mvs/shared";

function projectMetaKey(id: string): string {
  return `projects/${id}/project.json`;
}

export async function saveProject(
  id: string,
  name: string,
  state: Record<string, unknown>,
): Promise<ProjectMeta> {
  const copiedFiles = new Map<string, string>();
  if (config.STORAGE_BACKEND === "local") {
    const dir = join(config.STORAGE_DIR, "projects", id);
    const filesDir = join(dir, "files");
    await ensureDir(filesDir);
    for (const url of collectUrls(state)) {
      const localPath = resolveLocalPath(url);
      if (!localPath || !existsSync(localPath)) continue;
      const filename = basename(localPath);
      const dest = join(filesDir, filename);
      if (!existsSync(dest)) await copyFile(localPath, dest);
      copiedFiles.set(url, `/storage/projects/${id}/files/${filename}`);
    }
  }

  const rewritten = JSON.parse(JSON.stringify(state)) as JsonMutable;
  if (copiedFiles.size > 0) rewriteUrls(rewritten, copiedFiles);

  let thumbnailUrl: string | null = null;
  const clips = state.clips;
  if (Array.isArray(clips)) {
    const ready = clips.find((c: any) => c.status === "ready" && c.videoUrl);
    if (ready) thumbnailUrl = copiedFiles.get(ready.videoUrl) ?? ready.videoUrl;
  }

  const savedAt = new Date().toISOString();
  const meta: ProjectMeta = { id, name, savedAt, thumbnailUrl: thumbnailUrl ?? undefined };
  const saved: SavedProject = {
    meta,
    id,
    name,
    savedAt,
    thumbnailUrl: thumbnailUrl ?? undefined,
    state: rewritten as Record<string, unknown>,
    snapshot: (rewritten as Record<string, unknown>) ?? {},
    files: [...copiedFiles.values()].map((f) => ({ url: f })),
  };

  await storage.saveJson(projectMetaKey(id), saved);
  return {
    ...meta,
    thumbnailUrl: meta.thumbnailUrl ? await playableUrl(meta.thumbnailUrl) : undefined,
  };
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const keys = await storage.listJson("projects/");
  const metas: ProjectMeta[] = [];

  for (const key of keys) {
    if (!key.endsWith("/project.json")) continue;
    try {
      const raw = await storage.loadJson<SavedProject>(key);
      if (!raw) continue;
      const id = raw.id ?? raw.meta?.id ?? "";
      const name = raw.name ?? raw.meta?.name ?? "Untitled Project";
      const savedAt = raw.savedAt ?? raw.meta?.savedAt ?? "";
      const thumbnailUrl = raw.thumbnailUrl ?? raw.meta?.thumbnailUrl;
      metas.push({
        id,
        name,
        savedAt,
        thumbnailUrl: thumbnailUrl ? await playableUrl(thumbnailUrl) : undefined,
      });
    } catch {
      // Skip corrupt or inaccessible project entries.
    }
  }

  metas.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  return metas;
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  const saved = await storage.loadJson<SavedProject>(projectMetaKey(id));
  if (!saved) return null;
  return refreshMediaUrls(saved) as Promise<SavedProject>;
}

export async function deleteProject(id: string): Promise<boolean> {
  const existed = await storage.deleteJson(projectMetaKey(id));
  if (config.STORAGE_BACKEND === "local") {
    const dir = join(config.STORAGE_DIR, "projects", id);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
  return existed;
}

export async function listRenders(): Promise<Array<{ name: string; url: string; size: number; modifiedAt: string }>> {
  const files = await storage.listFiles("renders/");
  return files
    .filter((f) => f.key.endsWith(".mp4"))
    .map((f) => ({
      name: basename(f.key),
      url: f.publicUrl,
      size: f.size,
      modifiedAt: f.modifiedAt,
    }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

type JsonMutable =
  | string
  | number
  | boolean
  | null
  | JsonMutable[]
  | { [key: string]: JsonMutable };

function collectUrls(obj: unknown, urls = new Set<string>()): Set<string> {
  if (typeof obj === "string" && (obj.startsWith("http://") || obj.startsWith("https://"))) {
    urls.add(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) collectUrls(item, urls);
  } else if (obj && typeof obj === "object") {
    for (const val of Object.values(obj)) collectUrls(val, urls);
  }
  return urls;
}

function rewriteUrls(obj: JsonMutable, map: Map<string, string>): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i]!;
      if (typeof v === "string" && map.has(v)) {
        obj[i] = map.get(v)!;
      } else {
        rewriteUrls(v, map);
      }
    }
  } else if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      const v = obj[key]!;
      if (typeof v === "string" && map.has(v)) {
        obj[key] = map.get(v)!;
      } else {
        rewriteUrls(v, map);
      }
    }
  }
}

async function refreshMediaUrls(value: JsonMutable): Promise<JsonMutable> {
  if (typeof value === "string") return playableUrl(value);
  if (Array.isArray(value)) return Promise.all(value.map(refreshMediaUrls));
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await refreshMediaUrls(item)] as const)
    );
    return Object.fromEntries(entries) as { [key: string]: JsonMutable };
  }
  return value;
}
