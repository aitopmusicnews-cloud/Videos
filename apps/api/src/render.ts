import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { paths, storage } from "./storage.js";
import { config } from "./config.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";
import { resolveLocalPath } from "./paths.js";

export type RenderClip = {
  start: number;
  end: number;
  videoUrl: string;
  /** Clip source — only used to gate the lipSync-specific render path
   *  (no time-stretch, hard trim instead, so lips stay in sync with audio). */
  source?: string;
};

export type RenderRequest = {
  projectId: string;
  audioUrl: string;
  duration: number;
  clips: RenderClip[];
  /** When true, apply a 150ms alpha fade-in/out to each clip. Off by default. */
  fades?: boolean;
};

const FADE_DURATION = 0.15;

/**
 * Stitch a timeline into an MP4. ffmpeg writes to a local file first, then we
 * push to whichever storage backend is configured (local or S3).
 *
 * v1 stub: hard cuts by default. Pass `fades: true` for a 150ms alpha fade
 * at each clip's edges (gentler boundaries; not real crossfades).
 */
export async function renderTimeline(req: RenderRequest): Promise<{ url: string }> {
  // Resolve local paths where possible to avoid loopback network request failures.
  const resolvedClips = req.clips.map((c) => {
    const local = resolveLocalPath(c.videoUrl);
    return {
      ...c,
      resolvedPath: local ?? c.videoUrl,
      isLocal: !!local,
    };
  });
  const resolvedAudioPath = resolveLocalPath(req.audioUrl) ?? req.audioUrl;

  // SSRF guard: every URL ffmpeg sees comes from the client. Refuse
  // pre-flight if any of them resolve to a private/loopback IP.
  for (const c of resolvedClips) {
    if (!c.isLocal && /^https?:\/\//i.test(c.videoUrl)) {
      await assertSafeHost(c.videoUrl);
    }
  }
  if (!resolveLocalPath(req.audioUrl) && /^https?:\/\//i.test(req.audioUrl)) {
    await assertSafeHost(req.audioUrl);
  }

  await mkdir(paths.RENDERS, { recursive: true });
  const outputName = `${req.projectId}.mp4`;
  const outputPath = join(paths.RENDERS, outputName);

  if (req.clips.length > 50) {
    console.log(
      `render: ${req.clips.length} clips — overlay chain may be slow`
    );
  }

  // Probe each source video so we can time-stretch it into its timeline slot.
  // Without this, sources shorter than their slot freeze on the last frame and
  // sources longer than their slot get cut mid-motion (the "catch-up" feel).
  // Probe failures degrade to no-stretch (the previous behavior).
  const sourceDurations = await Promise.all(
    resolvedClips.map(async (c) => {
      try {
        return await probeDuration(c.resolvedPath);
      } catch (err) {
        console.log(`render: probe failed for ${c.resolvedPath}, skipping stretch`, err);
        return c.end - c.start;
      }
    })
  );

  const filterComplex: string[] = [];
  const inputs: string[] = [];

  inputs.push("-f", "lavfi", "-i", `color=c=black:s=1280x720:r=30:d=${req.duration}`);
  for (const clip of resolvedClips) inputs.push("-i", clip.resolvedPath);
  inputs.push("-i", resolvedAudioPath);

  let chain = "[0:v]";
  for (let i = 0; i < resolvedClips.length; i++) {
    const clip = resolvedClips[i]!;
    const inputIdx = i + 1;
    const tagOut = `v${i + 1}`;
    const slotDur = clip.end - clip.start;
    const srcDur = sourceDurations[i]!;

    // Per-source clip processing:
    //  - lipSync: NEVER time-stretch — that de-syncs the avatar's mouth from
    //    the song. Trim to slot duration; if the source is shorter than the
    //    slot the overlay simply stops emitting frames after the source ends
    //    and the black base shows through (the moveBoundary store guard
    //    keeps lipSync videos only when the new slot is a strict prefix of
    //    the original generation, so this case is rare in practice).
    //  - everything else: time-stretch K = slotDur / srcDur (clamped).
    let baseChain: string;
    const scalePad =
      `[${inputIdx}:v]scale=1280:720:force_original_aspect_ratio=decrease,` +
      `pad=1280:720:(ow-iw)/2:(oh-ih)/2`;
    if (clip.source === "lipSync") {
      baseChain =
        `${scalePad},trim=duration=${slotDur.toFixed(6)},` +
        `setpts=PTS-STARTPTS+${clip.start.toFixed(6)}/TB`;
    } else {
      // K > 1 slows the source (fills a longer slot), K < 1 speeds it up
      // (fits a shorter slot). Clamp K so a garbage probe (1ms) can't blow
      // the filter graph up.
      const k = Math.max(0.25, Math.min(8, slotDur / srcDur));
      baseChain = `${scalePad},setpts=(PTS-STARTPTS)*${k.toFixed(6)}+${clip.start.toFixed(6)}/TB`;
    }

    const fadeChain = req.fades
      ? `,fade=t=in:st=${clip.start}:d=${FADE_DURATION}:alpha=1,` +
        `fade=t=out:st=${Math.max(clip.start, clip.end - FADE_DURATION)}:d=${FADE_DURATION}:alpha=1`
      : "";

    filterComplex.push(`${baseChain}${fadeChain}[c${i}]`);
    filterComplex.push(`${chain}[c${i}]overlay=enable='between(t,${clip.start},${clip.end})'[${tagOut}]`);
    chain = `[${tagOut}]`;
  }

  const audioIdx = req.clips.length + 1;
  const args = [
    ...inputs,
    "-filter_complex",
    filterComplex.join(";"),
    "-map", chain,
    "-map", `${audioIdx}:a`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-y",
    outputPath,
  ];

  await runFfmpeg(args);
  const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
  // In s3 mode the saveRender call read the file into memory and pushed it
  // to the bucket; the local copy on Fargate's 20 GiB ephemeral disk is
  // dead weight. (Local-mode renames the file into the renders dir, so we
  // mustn't delete in that case.)
  if (config.STORAGE_BACKEND === "s3") {
    await unlink(outputPath).catch(() => {});
  }
  return { url: publicUrl };
}

export async function writeRenderManifest(projectId: string, req: RenderRequest): Promise<void> {
  await storage.saveJson(`renders/${projectId}.manifest.json`, req);
}
