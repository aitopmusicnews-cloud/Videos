import { playableUrl, storage } from "./storage.js";
import { rehostExternalUrl } from "./rehost.js";
import type { SavedImage } from "@mvs/shared";

function imageMetaKey(id: string): string {
  return `images/${id}/image.json`;
}

export async function saveImage(input: {
  id: string;
  name: string;
  url: string;
  source: string;
  prompt: string | null;
  model: string | null;
  folderId?: string | null;
}): Promise<SavedImage> {
  const durableUrl = await rehostExternalUrl(input.url, ".png");

  const saved: SavedImage = {
    id: input.id,
    name: input.name,
    url: durableUrl,
    source: input.source,
    prompt: input.prompt,
    model: input.model,
    savedAt: new Date().toISOString(),
    folderId: input.folderId,
  };

  await storage.saveJson(imageMetaKey(input.id), saved);
  return { ...saved, url: await playableUrl(saved.url) };
}

export async function listImages(): Promise<SavedImage[]> {
  const keys = await storage.listJson("images/");
  const images: SavedImage[] = [];
  for (const key of keys) {
    if (!key.endsWith("/image.json")) continue;
    try {
      const image = await storage.loadJson<SavedImage>(key);
      if (image) images.push({ ...image, url: await playableUrl(image.url) });
    } catch {
      // Skip corrupt or inaccessible metadata entries.
    }
  }
  images.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  return images;
}

export async function deleteImage(id: string): Promise<boolean> {
  return storage.deleteJson(imageMetaKey(id));
}
