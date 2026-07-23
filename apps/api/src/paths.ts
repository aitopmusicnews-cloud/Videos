import { resolve, relative, isAbsolute, sep, extname } from "node:path";
import { config } from "./config.js";

/**
 * If `url` points to a file in our local storage, return its absolute path.
 * Returns null for external URLs. Throws if the resolved path escapes the
 * storage directory (path-traversal protection).
 */
export function resolveLocalPath(url: string): string | null {
  let relativePath: string | null = null;
  const prefix = `${config.PUBLIC_BASE_URL}/storage/`;

  if (url.startsWith(prefix)) {
    relativePath = url.slice(prefix.length);
  } else if (url.startsWith("/storage/")) {
    relativePath = url.slice("/storage/".length);
  } else {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.startsWith("/storage/")) {
        relativePath = parsedUrl.pathname.slice("/storage/".length);
      }
    } catch {
      // Not a valid full URL
    }
  }

  if (relativePath === null) return null;

  const root = resolve(process.cwd(), config.STORAGE_DIR);
  const filePath = resolve(root, relativePath);
  // Use `path.relative` rather than `startsWith` so siblings with a shared
  // prefix (e.g. /app/storage-evil/...) don't masquerade as being inside
  // /app/storage. Reject anything that climbs out via `..` (parent ref),
  // is absolute (different drive on Windows, or a crafted path), or is
  // empty (filePath exactly equal to root, with no actual file specified).
  const rel = relative(root, filePath);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("path escapes storage directory");
  }
  return filePath;
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};

export function mimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}
