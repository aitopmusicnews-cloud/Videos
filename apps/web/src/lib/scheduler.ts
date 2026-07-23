import { useStore } from "./store.js";
import {
  startImageToVideo,
  startVideoToVideo,
  startLipSync,
  startTextToImage,
  startTextToVideo,
  pollTask,
  extractLastFrame,
  sliceAudio,
  ensureVocalStem,
  saveClipToServer,
  ApiError,
} from "./api.js";
import { toast } from "./toast.js";
import type { Clip, GenerationModel, Task } from "@mvs/shared";
import { modelSupportsBridge } from "@mvs/shared";

/** How many Runway generations to run in parallel. */
export const MAX_CONCURRENT = 3;

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  clipId: string;
  state: JobState;
  taskId: string | null;
  error: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Block until this job is resolved (succeeded / failed / cancelled). */
  waitForJobId: string | null;
  input: {
    source: Clip["source"];
    seedImageUrl: string;
    /** For aleph (video-to-video): the existing clip's video URL. */
    inputVideoUrl?: string;
    /** For lipSync: identifies the song so we can fetch / cache the vocal stem. */
    songId?: string;
    audioUrl?: string;
    avatarId?: string;
    clipStart?: number;
    clipEnd?: number;
    prompt: string;
    /** For generated: prompt for the text-to-image step. Falls back to `prompt`. */
    imagePrompt?: string;
    duration: number;
    sectionLabel: string;
    energy: number;
    model?: GenerationModel;
    /** For generated: lookbook URLs to pass as references to text-to-image. */
    referenceImages?: string[];
    /** For continue: when true and the model supports a `last` keyframe AND
     *  the next clip is ready, send first+last frames so Runway interpolates. */
    bridge?: boolean;
  };
};

export type EnqueueInput = {
  clipId: string;
  source: Clip["source"];
  seedImageUrl: string;
  inputVideoUrl?: string;
  songId?: string;
  audioUrl?: string;
  avatarId?: string;
  clipStart?: number;
  clipEnd?: number;
  prompt: string;
  imagePrompt?: string;
  duration: number;
  sectionLabel: string;
  energy: number;
  model?: GenerationModel;
  referenceImages?: string[];
  bridge?: boolean;
};

const newJobId = () => `job-${crypto.randomUUID().slice(0, 8)}`;

let resumed = false;

/** Re-poll any clips that were mid-generation when the page last unloaded. */
export function resumeInflightJobs(): void {
  if (resumed) return;
  resumed = true;

  const { clips } = useStore.getState();
  const inflight = clips.filter(
    (c) => c.status === "generating" && c.generationTaskId
  );
  if (!inflight.length) return;

  console.info(`resuming ${inflight.length} inflight generation(s)`);
  for (const clip of inflight) {
    void resumeClipPoll(clip.id, clip.generationTaskId!, clip.model);
  }
}

async function resumeClipPoll(
  clipId: string,
  taskId: string,
  model?: GenerationModel,
): Promise<void> {
  try {
    const slow = model === "seedance2" || model === "veo3.1";
    const final: Task = await pollTask(taskId, slow ? 5000 : 2500, slow ? 900_000 : 600_000);

    if (final.status === "SUCCEEDED" && final.output?.[0]) {
      const videoUrl = final.output[0];
      useStore.getState().updateClip(clipId, {
        videoUrl,
        status: "ready",
        lastError: undefined,
      });
      toast.success("Resumed clip ready");

      const clip = useStore.getState().clips.find((c) => c.id === clipId);
      void saveClipToServer({
        id: clipId,
        name: clip?.prompt?.slice(0, 60) || "resumed clip",
        videoUrl,
        source: clip?.source ?? "continue",
        prompt: clip?.prompt || null,
        duration: clip ? clip.end - clip.start : 5,
        sectionLabel: "resumed",
      })
        .then((saved) => {
          if (saved.videoUrl && saved.videoUrl !== videoUrl) {
            useStore.getState().updateClip(clipId, { videoUrl: saved.videoUrl });
          }
        })
        .catch((err) => console.warn("auto-save resumed clip failed", err));
    } else {
      const reason = final.error ?? `task ended in ${final.status}`;
      useStore.getState().updateClip(clipId, { status: "failed", lastError: reason });
      toast.error(`Resumed generation failed: ${reason.slice(0, 80)}`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    useStore.getState().updateClip(clipId, { status: "failed", lastError: reason });
    toast.error(`Resumed generation failed: ${reason.slice(0, 80)}`);
  }
}

export function enqueueGeneration(input: EnqueueInput): string {
  const existing = useStore.getState().jobs.filter(
    (j) => j.clipId === input.clipId && (j.state === "queued" || j.state === "running")
  );
  for (const j of existing) cancelJob(j.id);

  let waitForJobId: string | null = null;
  if (input.source === "continue") {
    const { clips, jobs } = useStore.getState();
    const idx = clips.findIndex((c) => c.id === input.clipId);
    if (idx > 0) {
      const prev = clips[idx - 1]!;
      const prevJob = jobs.find(
        (j) => j.clipId === prev.id && (j.state === "queued" || j.state === "running")
      );
      if (prevJob) waitForJobId = prevJob.id;
    }
  }

  const id = newJobId();
  const job: Job = {
    id,
    clipId: input.clipId,
    state: "queued",
    taskId: null,
    error: null,
    enqueuedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    waitForJobId,
    input: {
      source: input.source,
      seedImageUrl: input.seedImageUrl,
      inputVideoUrl: input.inputVideoUrl,
      songId: input.songId,
      audioUrl: input.audioUrl,
      avatarId: input.avatarId,
      clipStart: input.clipStart,
      clipEnd: input.clipEnd,
      prompt: input.prompt,
      imagePrompt: input.imagePrompt,
      duration: input.duration,
      sectionLabel: input.sectionLabel,
      energy: input.energy,
      model: input.model,
      referenceImages: input.referenceImages,
      bridge: input.bridge,
    },
  };
  useStore.getState().setJobs((prev) => [...prev, job]);
  useStore.getState().updateClip(input.clipId, {
    status: "queued",
    prompt: input.prompt,
    lastError: undefined,
  });
  pump();
  return id;
}

export function cancelJob(jobId: string): void {
  const { jobs } = useStore.getState();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;
  if (job.state === "queued") {
    useStore.getState().setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, state: "cancelled", completedAt: Date.now() } : j))
    );
    useStore.getState().updateClip(job.clipId, { status: "empty" });
  } else if (job.state === "running") {
    useStore.getState().setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, state: "cancelled" } : j))
    );
  }
  pump();
}

function isResolved(state: JobState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

function pump() {
  const { jobs } = useStore.getState();
  const running = jobs.filter((j) => j.state === "running").length;
  const slots = MAX_CONCURRENT - running;
  if (slots <= 0) return;

  const eligible = jobs.filter((j) => {
    if (j.state !== "queued") return false;
    if (j.waitForJobId === null) return true;
    const dep = jobs.find((d) => d.id === j.waitForJobId);
    return !dep || isResolved(dep.state);
  });

  for (const job of eligible.slice(0, slots)) {
    void run(job.id);
  }
}

type ContinueResult = { seed: string; seedEnd?: string };

async function resolveContinue(job: Job): Promise<ContinueResult> {
  const { clips } = useStore.getState();
  const idx = clips.findIndex((c) => c.id === job.clipId);
  if (idx <= 0) return { seed: job.input.seedImageUrl };
  const prev = clips[idx - 1]!;
  if (!prev.videoUrl) return { seed: job.input.seedImageUrl };

  // Don't pass a time hint — extractLastFrame uses `-sseof -0.1` which seeks
  // from the END of the actual video. Passing `prev.end - prev.start` (the
  // timeline duration) breaks when the model clamped output to a shorter
  // duration (e.g., Veo 3.1 caps at 8s but the timeline clip can be longer),
  // because `-ss <past_eof>` produces zero frames and ffmpeg silently exits 0.
  let seed: string;
  try {
    const { url } = await extractLastFrame(prev.videoUrl);
    seed = url;
  } catch (err) {
    console.warn("continue resolution failed; using fallback seed", err);
    return { seed: job.input.seedImageUrl };
  }

  // Bridge mode: if the user opted in, the chosen model accepts a `last`
  // keyframe, AND the next clip is ready, also extract the next clip's
  // first frame (time=0) so Runway interpolates between the two.
  if (job.input.bridge && modelSupportsBridge(job.input.model ?? "")) {
    const next = clips[idx + 1];
    if (next?.status === "ready" && next.videoUrl) {
      try {
        const { url } = await extractLastFrame(next.videoUrl, 0);
        return { seed, seedEnd: url };
      } catch (err) {
        console.warn("bridge: next-clip first-frame failed; using single-frame init", err);
      }
    }
  }

  return { seed };
}

function isCancelled(jobId: string): boolean {
  return useStore.getState().jobs.find((j) => j.id === jobId)?.state === "cancelled";
}

function setJobPatch(jobId: string, patch: Partial<Job>) {
  useStore.getState().setJobs((prev) =>
    prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j))
  );
}

/** Snap a freeform clip duration to a value the chosen model accepts. */
function durationFor(model: GenerationModel, d: number): number {
  switch (model) {
    case "seedance2":
      return Math.min(15, Math.max(5, Math.ceil(d)));
    case "gen4_turbo":
      return d > 8 ? 10 : d > 5 ? 8 : 5;
    case "gen4.5":
      return Math.min(10, Math.max(2, Math.ceil(d)));
    case "veo3.1":
    case "veo3.1_fast":
      // Pick nearest of 4 / 6 / 8.
      return [4, 6, 8].reduce((best, opt) =>
        Math.abs(opt - d) < Math.abs(best - d) ? opt : best
      );
    default:
      return 5;
  }
}

/** Kick off the right Runway primitive for this job's source. */
async function startTask(job: Job): Promise<{ id: string }> {
  const model: GenerationModel = job.input.model ?? "seedance2";
  const duration = durationFor(model, job.input.duration);
  const promptText =
    job.input.prompt ||
    `${job.input.sectionLabel}, energy ${job.input.energy.toFixed(2)}, cinematic`;

  if (job.input.source === "aleph") {
    if (!job.input.inputVideoUrl) throw new Error("aleph requires an existing clip video");
    return startVideoToVideo({
      videoUri: job.input.inputVideoUrl,
      promptText,
      ratio: "1280:720",
      // video-to-video accepts only seedance2 or gen4_aleph; map anything
      // else to gen4_aleph as the default restyle path.
      model: model === "seedance2" ? "seedance2" : "gen4_aleph",
    });
  }

  if (job.input.source === "textToVideo") {
    // text-to-video accepts gen4.5 / gen4_turbo / seedance2 / veo3.1 / veo3.1_fast
    const ttvModel: "gen4.5" | "gen4_turbo" | "seedance2" | "veo3.1" | "veo3.1_fast" =
      model === "seedance2" ? "seedance2"
      : model === "veo3.1" ? "veo3.1"
      : model === "veo3.1_fast" ? "veo3.1_fast"
      : model === "gen4_turbo" ? "gen4_turbo"
      : "gen4.5";
    return startTextToVideo({
      promptText,
      model: ttvModel,
      ratio: "1280:720",
      duration: durationFor(ttvModel as GenerationModel, job.input.duration),
    });
  }

  if (job.input.source === "lipSync") {
    if (!job.input.songId || !job.input.audioUrl) {
      throw new Error("lipSync requires a song to derive vocals from");
    }
    if (!job.input.avatarId) {
      throw new Error("lipSync requires an avatar — upload a character image first");
    }
    if (job.input.clipStart === undefined || job.input.clipEnd === undefined) {
      throw new Error("lipSync requires clip start/end");
    }
    const slice = await sliceAudio(job.input.audioUrl, job.input.clipStart, job.input.clipEnd);
    // Cache key is derived from `slice.url` (content-addressed) inside
    // ensureVocalStem, so a boundary drag → new slice → new key → fresh stem.
    const stem = await ensureVocalStem(slice.url);
    return startLipSync({
      avatarId: job.input.avatarId,
      audioUri: stem.url,
    });
  }

  // Default path: image-to-video. Used by `continue`, `archetype`, and
  // `generated` (which first generates the seed image from text).
  let seed = job.input.seedImageUrl;
  let seedEnd: string | undefined;
  const finalPrompt = promptText;
  if (job.input.source === "continue") {
    const cont = await resolveContinue(job);
    seed = cont.seed;
    seedEnd = cont.seedEnd;
  } else if (job.input.source === "generated") {
    seed = await generateSeedImage(job, promptText);
  }
  return startImageToVideo({
    promptImage: seed,
    ...(seedEnd ? { promptImageEnd: seedEnd } : {}),
    promptText: finalPrompt,
    ratio: "1280:720",
    duration,
    model,
  });
}

/**
 * For `generated` clips: text-to-image first, polled to completion, then the
 * resulting image becomes the seed for the image-to-video step. Lookbook
 * images (up to 3) are passed as references to keep style consistent across
 * a project.
 */
async function generateSeedImage(job: Job, promptText: string): Promise<string> {
  const refs = (job.input.referenceImages ?? []).slice(0, 3).map((uri) => ({ uri }));
  const imagePrompt = job.input.imagePrompt?.trim() || promptText;
  const { id } = await startTextToImage({
    promptText: imagePrompt,
    model: "gen4_image",
    ratio: "1280:720",
    ...(refs.length ? { referenceImages: refs } : {}),
  });
  const final = await pollTask(id);
  const imgUrl = final.outputUrl || (final.output as any)?.imageUrl || (final.output as any)?.[0] || (final.output as any)?.url;
  if ((final.status || "").toUpperCase() !== "SUCCEEDED" || !imgUrl) {
    const reason = final.error ?? `image-gen ${(final.status || "").toLowerCase()}`;
    throw new Error(`seed image failed: ${reason}`);
  }
  return imgUrl;
}

async function run(jobId: string): Promise<void> {
  const startState = useStore.getState();
  const job = startState.jobs.find((j) => j.id === jobId);
  if (!job || job.state !== "queued") return;

  setJobPatch(jobId, { state: "running", startedAt: Date.now() });
  useStore.getState().updateClip(job.clipId, { status: "generating" });

  try {
    const task = await startTask(job);
    setJobPatch(jobId, { taskId: task.id });
    useStore.getState().updateClip(job.clipId, { generationTaskId: task.id });

    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }

    const slowModel = job.input.model === "seedance2" || job.input.model === "veo3.1";
    const final: Task = await pollTask(task.id, slowModel ? 5000 : 2500, slowModel ? 900_000 : 600_000);

    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }

    if (final.status === "SUCCEEDED" && final.output?.[0]) {
      const videoUrl = final.output[0];
      setJobPatch(jobId, { state: "succeeded", completedAt: Date.now() });
      useStore.getState().updateClip(job.clipId, {
        videoUrl,
        status: "ready",
        lastError: undefined,
      });
      toast.success(`Clip ready (${job.input.sectionLabel})`);

      // Auto-save into the clip library. Uses the timeline clip's id as the
      // saved-clip id so re-generations overwrite the same entry instead of
      // piling up duplicates. The server rehosts external (Runway) URLs into
      // /storage/clips/<id>/, so on success we replace the timeline clip's
      // URL with the durable one — otherwise the saved project snapshot
      // points at a Runway link that expires ~24–48h later.
      void saveClipToServer({
        id: job.clipId,
        name: job.input.prompt?.slice(0, 60) || `${job.input.sectionLabel} clip`,
        videoUrl,
        source: job.input.source,
        prompt: job.input.prompt || null,
        duration: job.input.duration,
        sectionLabel: job.input.sectionLabel,
      })
        .then((saved) => {
          if (saved.videoUrl && saved.videoUrl !== videoUrl) {
            useStore.getState().updateClip(job.clipId, { videoUrl: saved.videoUrl });
          }
        })
        .catch((err) => console.warn("auto-save to clip library failed", err));
    } else {
      const reason = final.error ?? `task ended in ${final.status} with no output`;
      setJobPatch(jobId, { state: "failed", error: reason, completedAt: Date.now() });
      useStore.getState().updateClip(job.clipId, { status: "failed", lastError: reason });
      toast.error(`Generation failed: ${reason.slice(0, 80)}`);
    }
  } catch (err) {
    const isRateLimit = err instanceof ApiError && err.rateLimited;
    const reason = isRateLimit
      ? "Runway daily task limit reached — resets at midnight UTC"
      : err instanceof Error ? err.message : String(err);
    setJobPatch(jobId, { state: "failed", error: reason, completedAt: Date.now() });
    useStore.getState().updateClip(job.clipId, { status: "failed", lastError: reason });
    if (isRateLimit) {
      toast.warning("Runway daily limit reached. Your quota resets at midnight UTC.", 8000);
    } else {
      toast.error(`Generation failed: ${reason.slice(0, 120)}`);
    }
  } finally {
    pump();
  }
}
