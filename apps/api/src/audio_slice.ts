import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { storage } from "./storage.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";
import { resolveLocalPath } from "./paths.js";

/** Slice a [start, end] window out of a remote audio URL via ffmpeg, then push
 * the result through the storage backend. Re-encodes to mp3 so seeks are
 * frame-accurate (stream-copy with mp3 input is often off by a frame). */
export async function sliceAudio(
  audioUrl: string,
  start: number,
  end: number
): Promise<{ url: string }> {
  if (end <= start) throw new Error("slice end must be > start");
  const localPath = resolveLocalPath(audioUrl);
  if (!localPath && /^https?:\/\//i.test(audioUrl)) {
    await assertSafeHost(audioUrl);
  }
  const inputPath = localPath ?? audioUrl;

  const dur = (end - start).toFixed(3);
  const tempPath = join(
    tmpdir(),
    `slice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`
  );

  await runFfmpeg([
    "-ss", start.toFixed(3),
    "-t", dur,
    "-i", inputPath,
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    "-y",
    tempPath,
  ]);

  const buf = await readFile(tempPath);
  await unlink(tempPath).catch(() => {});
  const { publicUrl } = await storage.saveUpload(buf, "slice.mp3", "audio/mpeg");
  return { url: publicUrl };
}

