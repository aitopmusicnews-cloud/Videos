import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { storage } from "./storage.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";
import { resolveLocalPath } from "./paths.js";

/** Extract the last frame of a video URL and persist it as a JPEG.
 *
 * Uses `-sseof -0.1` to seek 0.1s before the end (fast, doesn't read the
 * whole video). Saves through the storage backend so the resulting URL is
 * fetchable by Runway and the frontend.
 */
export async function extractLastFrame(videoUrl: string, time?: number): Promise<{ url: string }> {
  const localPath = resolveLocalPath(videoUrl);
  if (!localPath && /^https?:\/\//i.test(videoUrl)) {
    await assertSafeHost(videoUrl);
  }
  const inputPath = localPath ?? videoUrl;

  // PNG instead of JPEG: Veo's outputs ship as yuv420p with a
  // non-full-range tag, and ffmpeg's mjpeg encoder rejects that with
  // "Non full-range YUV is non-standard / ff_frame_thread_encoder_init
  // failed" even with -pix_fmt yuvj420p. PNG sidesteps the YUV-range
  // dance entirely (it goes straight through rgb24).
  const tempPath = join(
    tmpdir(),
    `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  );

  const seekArgs = time != null
    ? ["-ss", time.toFixed(3)]
    : ["-sseof", "-0.1"];

  await runFfmpeg([
    ...seekArgs,
    "-i", inputPath,
    "-update", "1",
    "-frames:v", "1",
    "-y",
    tempPath,
  ]);

  let buf: Buffer;
  try {
    buf = await readFile(tempPath);
  } catch (err) {
    // ffmpeg can exit 0 with no file written if the seek lands past the end
    // of the input or no frames pass the filter chain. Surface as a clear
    // error so callers can fall back instead of dragging ENOENT up the stack.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("ffmpeg produced no output frame (seek past end?)");
    }
    throw err;
  }
  if (buf.length === 0) {
    throw new Error("ffmpeg produced an empty output file");
  }
  await unlink(tempPath).catch(() => {});
  // Hashed by content via storage.saveUpload — repeated calls on the same
  // video produce the same URL, so no caching layer needed.
  const { publicUrl } = await storage.saveUpload(buf, "frame.png", "image/png");
  return { url: publicUrl };
}

