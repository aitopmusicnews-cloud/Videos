import { storage } from "./storage.js";
import { rehostExternalUrl } from "./rehost.js";
import type { SavedClip } from "@mvs/shared";

function clipMetaKey(id: string): string {
  return `clips/${id}/clip.json`;
}

export async function saveClip(input: {
  id: string;
  name: string;
  videoUrl: string;
  source: string;
  prompt: string | null;
  duration: number;
  sectionLabel: string | null;
  folderId?: string | null;
  model?: string | null;
  generationTaskId?: string | null;
}): Promise<SavedClip> {
  // rehostExternalUrl is the single source of truth for "make this URL
  // durable on our storage backend": owned URLs (already on /storage or
  // our S3 bucket) pass through; external URLs (Runway etc.) get downloaded
  // and re-uploaded via storage.saveUpload, so the result is always on the
  // configured backend (S3 in prod, local disk in dev). Metadata goes through
  // the same backend, so saved clips persist across container restarts.
  const videoUrl = await rehostExternalUrl(input.videoUrl, ".mp4");

  const saved: SavedClip = {
    id: input.id,
    name: input.name,
    videoUrl,
    source: input.source,
    prompt: input.prompt,
    duration: input.duration,
    sectionLabel: input.sectionLabel,
    savedAt: new Date().toISOString(),
    folderId: input.folderId,
    model: input.model,
    generationTaskId: input.generationTaskId,
  };

  await storage.saveJson(clipMetaKey(input.id), saved);
  return saved;
}

export async function listClips(): Promise<SavedClip[]> {
  const keys = await storage.listJson("clips/");
  const clips: SavedClip[] = [];
  for (const key of keys) {
    if (!key.endsWith("/clip.json")) continue;
    try {
      const c = await storage.loadJson<SavedClip>(key);
      if (c) clips.push(c);
    } catch { /* skip corrupt */ }
  }
  clips.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return clips;
}

export async function deleteClip(id: string): Promise<boolean> {
  return storage.deleteJson(clipMetaKey(id));
}
