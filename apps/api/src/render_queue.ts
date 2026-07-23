import { randomUUID } from "node:crypto";
import { renderTimeline, writeRenderManifest, type RenderRequest } from "./render.js";
import { FfmpegError } from "./ffmpeg.js";

/**
 * In-process render queue. Render jobs are CPU-heavy (libx264 over a
 * multi-input filter graph) so we run them sequentially: a single worker
 * pulls one job at a time off an in-memory FIFO. POST /api/render returns
 * a renderId immediately; the client polls GET /api/render/jobs/:id for
 * progress and the final URL.
 *
 * State is process-local. A task restart wipes the queue — for our single-
 * tenant deploy that's acceptable; the user re-clicks Export. The longest
 * timeline we'd realistically queue is bounded by the ffmpeg subprocess
 * timeout (20 min).
 */

export type RenderJobState = "queued" | "running" | "succeeded" | "failed";

export interface RenderJob {
  id: string;
  state: RenderJobState;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  url: string | null;
  error: string | null;
  /** Position in the queue (0 = next to run, 1 = after one ahead, …).
   *  null once running / done. */
  queuePosition: number | null;
}

interface InternalJob extends RenderJob {
  request: RenderRequest;
}

const jobs = new Map<string, InternalJob>();
const pending: string[] = [];
let workerActive = false;

/** Drop completed-or-failed jobs older than 1 hour to bound memory.
 *  Called opportunistically on each submitRender. */
function gcOldJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (
      (job.state === "succeeded" || job.state === "failed") &&
      job.completedAt !== null &&
      job.completedAt < cutoff
    ) {
      jobs.delete(id);
    }
  }
}

function newRenderId(): string {
  return `render-${randomUUID().slice(0, 8)}`;
}

function snapshot(job: InternalJob): RenderJob {
  // Strip the request payload from the public view — it's already large
  // (clips list, audio URL) and the client doesn't need it back.
  return {
    id: job.id,
    state: job.state,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    url: job.url,
    error: job.error,
    queuePosition: job.queuePosition,
  };
}

export function submitRender(request: RenderRequest): RenderJob {
  gcOldJobs();
  const id = newRenderId();
  const job: InternalJob = {
    id,
    request,
    state: "queued",
    enqueuedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    url: null,
    error: null,
    queuePosition: pending.length,
  };
  jobs.set(id, job);
  pending.push(id);
  void runWorker();
  return snapshot(job);
}

export function getRenderJob(id: string): RenderJob | null {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

async function runWorker(): Promise<void> {
  if (workerActive) return;
  workerActive = true;
  try {
    // Single in-flight render at a time on this 2 vCPU task — concurrent
    // libx264 encodes would just contend for CPU and finish at the same total
    // wall clock anyway. Keep it sequential and predictable.
    while (pending.length > 0) {
      const id = pending.shift()!;
      const job = jobs.get(id);
      if (!job) continue;

      // Anyone still waiting moves up one position.
      for (let i = 0; i < pending.length; i++) {
        const j = jobs.get(pending[i]!);
        if (j) j.queuePosition = i;
      }

      job.state = "running";
      job.startedAt = Date.now();
      job.queuePosition = null;

      try {
        await writeRenderManifest(job.request.projectId, job.request);
        const result = await renderTimeline(job.request);
        job.url = result.url;
        job.state = "succeeded";
      } catch (err) {
        // FfmpegError carries stderr; redact for the public job snapshot
        // (Fastify error handler does the same for synchronous routes).
        job.error =
          err instanceof FfmpegError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        job.state = "failed";
        console.error(`render ${id} failed:`, err);
      }
      job.completedAt = Date.now();
    }
  } finally {
    workerActive = false;
  }
}
