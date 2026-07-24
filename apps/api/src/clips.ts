import { playableUrl, storage } from "./storage.js";
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
  const durableVideoUrl = await rehostExternalUrl(input.videoUrl, ".mp4");

  const saved: SavedClip = {
    id: input.id,
    name: input.name,
    videoUrl: durableVideoUrl,
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
  return { ...saved, videoUrl: await playableUrl(saved.videoUrl) };
}

export async function listClips(): Promise<SavedClip[]> {
  const keys = await storage.listJson("clips/");
  const clips: SavedClip[] = [];
  for (const key of keys) {
    if (!key.endsWith("/clip.json")) continue;
    try {
      const clip = await storage.loadJson<SavedClip>(key);
      if (clip) clips.push({ ...clip, videoUrl: await playableUrl(clip.videoUrl) });
    } catch {
      // Skip corrupt or inaccessible metadata entries.
    }
  }
  clips.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  return clips;
}

export async function deleteClip(id: string): Promise<boolean> {
  return storage.deleteJson(clipMetaKey(id));
}
