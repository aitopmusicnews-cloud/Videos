import { storage } from "./storage.js";
import { rehostExternalUrl } from "./rehost.js";
import type { SavedImage } from "@mvs/shared";

function imageMetaKey(id: string): string {
  return `images/${id}/image.json`;
}

/**
 * Persist a SavedImage entry. The asset URL is normalized through
 * rehostExternalUrl: owned URLs (already on /storage or our S3 bucket)
 * pass through unchanged; external URLs (Runway etc.) get downloaded and
 * re-uploaded via the storage backend so the entry survives the remote
 * signed link's ~24–48h expiry. Metadata goes through the same backend,
 * so saved images persist across container restarts.
 */
export async function saveImage(input: {
  id: string;
  name: string;
  url: string;
  source: string;
  prompt: string | null;
  model: string | null;
  folderId?: string | null;
}): Promise<SavedImage> {
  const url = await rehostExternalUrl(input.url, ".png");

  const saved: SavedImage = {
    id: input.id,
    name: input.name,
    url,
    source: input.source,
    prompt: input.prompt,
    model: input.model,
    savedAt: new Date().toISOString(),
    folderId: input.folderId,
  };

  await storage.saveJson(imageMetaKey(input.id), saved);
  return saved;
}

export async function listImages(): Promise<SavedImage[]> {
  const keys = await storage.listJson("images/");
  const images: SavedImage[] = [];
  for (const key of keys) {
    if (!key.endsWith("/image.json")) continue;
    try {
      const i = await storage.loadJson<SavedImage>(key);
      if (i) images.push(i);
    } catch { /* skip corrupt */ }
  }
  images.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return images;
}

export async function deleteImage(id: string): Promise<boolean> {
  return storage.deleteJson(imageMetaKey(id));
}
