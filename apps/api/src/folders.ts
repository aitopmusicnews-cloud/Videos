import { storage } from "./storage.js";
import type { LibraryFolder } from "@mvs/shared";

function folderMetaKey(id: string): string {
  return `folders/${id}/folder.json`;
}

export async function saveFolder(input: {
  id: string;
  name: string;
  parentId: string | null;
  type: "clips" | "images";
}): Promise<LibraryFolder> {
  const saved: LibraryFolder = {
    id: input.id,
    name: input.name,
    parentId: input.parentId,
    type: input.type,
    createdAt: new Date().toISOString(),
  };

  await storage.saveJson(folderMetaKey(input.id), saved);
  return saved;
}

export async function listFolders(): Promise<LibraryFolder[]> {
  const keys = await storage.listJson("folders/");
  const folders: LibraryFolder[] = [];
  for (const key of keys) {
    if (!key.endsWith("/folder.json")) continue;
    try {
      const f = await storage.loadJson<LibraryFolder>(key);
      if (f) folders.push(f);
    } catch { /* skip corrupt */ }
  }
  folders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return folders;
}

export async function deleteFolder(id: string): Promise<boolean> {
  return storage.deleteJson(folderMetaKey(id));
}
