import { useStore } from "./store.js";
import {
  startImageToVideo,
  startTextToVideo,
  pollTask,
  extractLastFrame,
  saveClipToServer,
  ApiError,
} from "./api.js";
import { toast } from "./toast.js";
import type { Clip, GenerationModel, Task } from "@mvs/shared";

/** Keep a small queue so one project does not launch an accidental GPU storm. */
export const MAX_CONCURRENT = 2;

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type LtxGenerationSource = "textToVideo" | "imageToVideo" | "continue";

export type Job = {
  id: string;
  clipId: string;
  state: JobState;
  taskId: string | null;
  error: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  waitForJobId: string | null;
  input: {
    source: LtxGenerationSource;
    seedImageUrl: string;
    prompt: string;
    duration: number;
    sectionLabel: string;
    energy: number;
    model: GenerationModel;
  };
};

export type EnqueueInput = {
  clipId: string;
  source: LtxGenerationSource;
  seedImageUrl: string;
  prompt: string;
  duration: number;
  sectionLabel: string;
  energy: number;
  model?: GenerationModel;
};

function taskSucceeded(task: Task): boolean {
  return (task.status || "").toUpperCase() === "SUCCEEDED";
}

function taskOutputUrl(task: Task): string | undefined {
  if (task.outputUrl) return task.outputUrl;
  if (Array.isArray(task.output)) return task.output[0];
  return task.output?.videoUrl ?? task.output?.imageUrl ?? task.output?.url;
}

const newJobId = () => `job-${crypto.randomUUID().slice(0, 8)}`;
let resumed = false;

/** Reattach to Modal jobs that were still running when the page reloaded. */
export function resumeInflightJobs(): void {
  if (resumed) return;
  resumed = true;

  const inflight = useStore.getState().clips.filter(
    (clip) => clip.status === "generating" && clip.generationTaskId,
  );

  for (const clip of inflight) {
    void resumeClipPoll(clip.id, clip.generationTaskId!);
  }
}

async function resumeClipPoll(clipId: string, taskId: string): Promise<void> {
  try {
    const final = await pollTask(taskId, 5000, 900_000);
    const videoUrl = taskOutputUrl(final);
    if (!taskSucceeded(final) || !videoUrl) {
      throw new Error(final.error ?? `task ended in ${final.status}`);
    }

    useStore.getState().updateClip(clipId, {
      videoUrl,
      status: "ready",
      lastError: undefined,
    });
    toast.success("Resumed LTX-2.3 clip ready");

    const clip = useStore.getState().clips.find((item) => item.id === clipId);
    if (clip) void persistGeneratedClip(clip, videoUrl, "resumed");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    useStore.getState().updateClip(clipId, { status: "failed", lastError: reason });
    toast.error(`Resumed generation failed: ${reason.slice(0, 80)}`);
  }
}

export function enqueueGeneration(input: EnqueueInput): string {
  const activeForClip = useStore.getState().jobs.filter(
    (job) => job.clipId === input.clipId && (job.state === "queued" || job.state === "running"),
  );
  for (const job of activeForClip) cancelJob(job.id);

  let waitForJobId: string | null = null;
  if (input.source === "continue") {
    const { clips, jobs } = useStore.getState();
    const index = clips.findIndex((clip) => clip.id === input.clipId);
    if (index > 0) {
      const previous = clips[index - 1]!;
      const previousJob = jobs.find(
        (job) => job.clipId === previous.id && (job.state === "queued" || job.state === "running"),
      );
      if (previousJob) waitForJobId = previousJob.id;
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
      prompt: input.prompt,
      duration: clampDuration(input.duration),
      sectionLabel: input.sectionLabel,
      energy: input.energy,
      model: "ltx-video",
    },
  };

  useStore.getState().setJobs((jobs) => [...jobs, job]);
  useStore.getState().updateClip(input.clipId, {
    source: input.source,
    model: "ltx-video",
    status: "queued",
    prompt: input.prompt,
    lastError: undefined,
  });
  pump();
  return id;
}

export function cancelJob(jobId: string): void {
  const job = useStore.getState().jobs.find((item) => item.id === jobId);
  if (!job) return;

  if (job.state === "queued") {
    useStore.getState().setJobs((jobs) =>
      jobs.map((item) => item.id === jobId
        ? { ...item, state: "cancelled", completedAt: Date.now() }
        : item),
    );
    useStore.getState().updateClip(job.clipId, { status: "empty" });
  } else if (job.state === "running") {
    useStore.getState().setJobs((jobs) =>
      jobs.map((item) => item.id === jobId ? { ...item, state: "cancelled" } : item),
    );
  }
  pump();
}

function isResolved(state: JobState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

function pump(): void {
  const jobs = useStore.getState().jobs;
  const slots = MAX_CONCURRENT - jobs.filter((job) => job.state === "running").length;
  if (slots <= 0) return;

  const eligible = jobs.filter((job) => {
    if (job.state !== "queued") return false;
    if (!job.waitForJobId) return true;
    const dependency = jobs.find((candidate) => candidate.id === job.waitForJobId);
    return !dependency || isResolved(dependency.state);
  });

  for (const job of eligible.slice(0, slots)) void run(job.id);
}

function isCancelled(jobId: string): boolean {
  return useStore.getState().jobs.find((job) => job.id === jobId)?.state === "cancelled";
}

function setJobPatch(jobId: string, patch: Partial<Job>): void {
  useStore.getState().setJobs((jobs) =>
    jobs.map((job) => job.id === jobId ? { ...job, ...patch } : job),
  );
}

function clampDuration(duration: number): number {
  const safe = Number.isFinite(duration) ? duration : 5;
  return Math.min(5, Math.max(1, safe));
}

async function resolvePreviousFrame(job: Job): Promise<string> {
  const clips = useStore.getState().clips;
  const index = clips.findIndex((clip) => clip.id === job.clipId);
  const previous = index > 0 ? clips[index - 1] : undefined;
  if (!previous?.videoUrl || previous.status !== "ready") {
    throw new Error("Continue mode requires a completed clip immediately to the left");
  }
  const { url } = await extractLastFrame(previous.videoUrl);
  return url;
}

async function startTask(job: Job): Promise<{ id: string }> {
  const promptText = job.input.prompt.trim();
  if (!promptText) throw new Error("A scene and audio prompt is required");

  if (job.input.source === "textToVideo") {
    return startTextToVideo({
      promptText,
      model: "ltx-video",
      ratio: "3:2",
      duration: job.input.duration,
    });
  }

  const firstFrame = job.input.source === "continue"
    ? await resolvePreviousFrame(job)
    : job.input.seedImageUrl;

  if (!firstFrame) throw new Error("Image-to-video requires a first-frame reference");

  return startImageToVideo({
    promptImage: firstFrame,
    promptText,
    ratio: "3:2",
    duration: job.input.duration,
    model: "ltx-video",
  });
}

async function run(jobId: string): Promise<void> {
  const job = useStore.getState().jobs.find((item) => item.id === jobId);
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

    const final = await pollTask(task.id, 5000, 900_000);
    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }

    const videoUrl = taskOutputUrl(final);
    if (!taskSucceeded(final) || !videoUrl) {
      throw new Error(final.error ?? `task ended in ${final.status} with no video`);
    }

    setJobPatch(jobId, { state: "succeeded", completedAt: Date.now() });
    useStore.getState().updateClip(job.clipId, {
      videoUrl,
      status: "ready",
      lastError: undefined,
    });
    toast.success(`LTX-2.3 clip ready (${job.input.sectionLabel})`);

    const clip = useStore.getState().clips.find((item) => item.id === job.clipId);
    if (clip) void persistGeneratedClip(clip, videoUrl, job.input.sectionLabel);
  } catch (error) {
    const rateLimited = error instanceof ApiError && error.rateLimited;
    const reason = rateLimited
      ? "The generation service rate limit was reached. Try again shortly."
      : error instanceof Error ? error.message : String(error);

    setJobPatch(jobId, { state: "failed", error: reason, completedAt: Date.now() });
    useStore.getState().updateClip(job.clipId, { status: "failed", lastError: reason });
    if (rateLimited) toast.warning(reason, 8000);
    else toast.error(`LTX-2.3 generation failed: ${reason.slice(0, 120)}`);
  } finally {
    pump();
  }
}

async function persistGeneratedClip(clip: Clip, videoUrl: string, sectionLabel: string): Promise<void> {
  try {
    const saved = await saveClipToServer({
      id: clip.id,
      name: clip.prompt?.slice(0, 60) || `${sectionLabel} clip`,
      videoUrl,
      source: clip.source,
      prompt: clip.prompt || null,
      duration: clip.end - clip.start,
      sectionLabel,
      model: "ltx-video",
      generationTaskId: clip.generationTaskId,
    });
    if (saved.videoUrl && saved.videoUrl !== videoUrl) {
      useStore.getState().updateClip(clip.id, { videoUrl: saved.videoUrl });
    }
  } catch (error) {
    console.warn("auto-save LTX clip failed", error);
  }
}
