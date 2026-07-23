import type {
  ImageToVideoRequest,
  TextToImageRequest,
  LipSyncRequest,
} from "@mvs/shared";
import { config } from "./config.js";
import { storage } from "./storage.js";

export interface JobRecord {
  status: "pending" | "running" | "completed" | "failed";
  video_url?: string;
  error?: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  modalCallId?: string;
}

function jobKey(jobId: string): string {
  return `jobs/${jobId}.json`;
}

export async function writeJobToDisk(jobId: string, record: JobRecord): Promise<void> {
  await storage.saveJson(jobKey(jobId), record);
}

export async function readJobFromDisk(jobId: string): Promise<JobRecord | null> {
  try {
    return await storage.loadJson<JobRecord>(jobKey(jobId));
  } catch (error) {
    console.error(`[Job Store] Failed to read ${jobId}:`, error);
    return null;
  }
}

export type ModalTask = { id: string };

interface TaskIdPayload {
  source: "modal";
  id: string;
}

export function encodeTaskId(payload: TaskIdPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeTaskId(encoded: string): TaskIdPayload {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (parsed?.source === "modal" && typeof parsed.id === "string") {
      return parsed as TaskIdPayload;
    }
  } catch {
    // Backward compatibility: old projects may contain an unencoded job id.
  }
  return { source: "modal", id: encoded };
}

function modalHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.MODAL_KEY && config.MODAL_SECRET) {
    headers["Modal-Key"] = config.MODAL_KEY;
    headers["Modal-Secret"] = config.MODAL_SECRET;
  }
  return headers;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text || `${response.status} ${response.statusText}`;
}

/** Launch an asynchronous LTX-2.3 generation on Modal. */
export async function imageToVideo(
  req: ImageToVideoRequest,
  callbackBaseUrl: string,
): Promise<ModalTask> {
  if (!config.MODAL_LTX_URL) {
    throw new Error("MODAL_LTX_URL is not configured in Render.");
  }

  const prompt = (req.promptText ?? req.prompt ?? "").trim();
  if (!prompt) throw new Error("A video prompt is required.");

  const duration = Math.min(5, Math.max(1, Number(req.duration ?? 5)));
  const initImageUrl = req.promptImage ?? req.imageUrl;
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  await writeJobToDisk(jobId, {
    status: "pending",
    prompt,
    createdAt: now,
    updatedAt: now,
  });

  const webhookUrl = `${callbackBaseUrl.replace(/\/$/, "")}/api/modal/webhook`;

  let response: Response;
  try {
    response = await fetch(config.MODAL_LTX_URL, {
      method: "POST",
      headers: modalHeaders(),
      body: JSON.stringify({
        prompt,
        duration,
        init_image_url: initImageUrl || undefined,
        job_id: jobId,
        webhook_url: webhookUrl,
      }),
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(jobId, {
      status: "failed",
      prompt,
      error: `Could not reach Modal: ${message}`,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw new Error(`Could not reach the Modal LTX service: ${message}`);
  }

  if (!response.ok) {
    const message = await responseError(response);
    await writeJobToDisk(jobId, {
      status: "failed",
      prompt,
      error: message,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw new Error(`Modal LTX pipeline rejected the request: ${message}`);
  }

  const accepted = (await response.json().catch(() => ({}))) as {
    call_id?: string;
    status?: string;
  };

  await writeJobToDisk(jobId, {
    status: "running",
    prompt,
    createdAt: now,
    updatedAt: Date.now(),
    modalCallId: accepted.call_id,
  });

  return { id: encodeTaskId({ source: "modal", id: jobId }) };
}

/** Native text-to-image character generation through the Modal media suite. */
export async function generateCharacterFrame(
  req: TextToImageRequest,
): Promise<{ imageUrl: string }> {
  if (!config.MODAL_MEDIA_SUITE_URL) {
    throw new Error("MODAL_MEDIA_SUITE_URL is not configured in Render.");
  }

  const prompt = (req.promptText ?? req.prompt ?? "").trim();
  if (!prompt) throw new Error("An image prompt is required.");

  const response = await fetch(config.MODAL_MEDIA_SUITE_URL, {
    method: "POST",
    headers: modalHeaders(),
    body: JSON.stringify({ prompt, aspect_ratio: req.ratio ?? "16:9" }),
    signal: AbortSignal.timeout(120_000),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Modal image engine failed: ${await responseError(response)}`);
  }

  const data = (await response.json()) as { url?: string; image_url?: string };
  const imageUrl = data.image_url ?? data.url;
  if (!imageUrl) throw new Error("Modal image engine returned no image URL.");
  return { imageUrl };
}

/** Character lip-sync connector. */
export async function animateLipSync(req: LipSyncRequest): Promise<ModalTask> {
  if (!config.MODAL_LIPSYNC_URL) {
    throw new Error("MODAL_LIPSYNC_URL is not configured in Render.");
  }

  const audioUrl = req.audioUri ?? req.audioUrl;
  if (!audioUrl) throw new Error("Lip-sync requires an audio URL.");

  const jobId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(config.MODAL_LIPSYNC_URL, {
    method: "POST",
    headers: modalHeaders(),
    body: JSON.stringify({
      audio_url: audioUrl,
      video_url: req.videoUrl,
      avatar_id: req.avatarId,
      job_id: jobId,
    }),
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Modal lip-sync service rejected the request: ${await responseError(response)}`);
  }

  return { id: encodeTaskId({ source: "modal", id: jobId }) };
}
