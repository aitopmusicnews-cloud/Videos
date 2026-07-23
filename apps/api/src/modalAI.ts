import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

type ModalMediaPayload = Record<string, string>;
const MAX_INLINE_MEDIA_BYTES = 150 * 1024 * 1024;

function absolutePublicUrl(rawUrl: string): string {
  if (!rawUrl.startsWith("/")) return rawUrl;
  if (!config.PUBLIC_BASE_URL) {
    throw new Error(`Cannot expose relative media URL without PUBLIC_BASE_URL: ${rawUrl}`);
  }
  return new URL(rawUrl, `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/`).toString();
}

function s3KeyFromUrl(rawUrl: string): string | null {
  if (config.STORAGE_BACKEND !== "s3" || !config.S3_BUCKET) return null;

  if (rawUrl.startsWith("/media/")) {
    return decodeURIComponent(rawUrl.slice("/media/".length));
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const virtualHostedPrefix = `${config.S3_BUCKET}.s3`;
  if (parsed.hostname === config.S3_BUCKET || parsed.hostname.startsWith(`${virtualHostedPrefix}.`)) {
    return path;
  }

  if (parsed.hostname.startsWith("s3.") || parsed.hostname === "s3.amazonaws.com") {
    const prefix = `${config.S3_BUCKET}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : null;
  }

  if (config.S3_PUBLIC_URL_BASE) {
    try {
      const base = new URL(config.S3_PUBLIC_URL_BASE);
      if (base.origin === parsed.origin) {
        const basePath = base.pathname.replace(/^\/+|\/+$/g, "");
        return basePath && path.startsWith(`${basePath}/`)
          ? path.slice(basePath.length + 1)
          : path;
      }
    } catch {
      // An invalid base URL is already rejected by config validation.
    }
  }

  return null;
}

async function modalMediaPayload(rawUrl: string, kind: "video" | "audio"): Promise<ModalMediaPayload> {
  const key = s3KeyFromUrl(rawUrl);
  if (!key) return { [`${kind}_url`]: absolutePublicUrl(rawUrl) };

  const client = new S3Client({ region: config.S3_REGION! });
  const response = await client.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: key })
  );
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Private S3 object is empty: ${key}`);
  if (bytes.byteLength > MAX_INLINE_MEDIA_BYTES) {
    throw new Error(
      `${kind} is too large for the private-media handoff (${Math.ceil(bytes.byteLength / 1024 / 1024)} MB). ` +
      "Use a clip of five seconds or less."
    );
  }

  const filename = key.split("/").pop() || `${kind}.bin`;
  return {
    [`${kind}_base64`]: Buffer.from(bytes).toString("base64"),
    [`${kind}_filename`]: filename,
  };
}

/** Launch an asynchronous LTX-2.3 LipDub job. */
export async function animateLipSync(req: LipSyncRequest): Promise<ModalTask> {
  if (!config.MODAL_LIPSYNC_URL) {
    throw new Error("MODAL_LIPSYNC_URL is not configured in Render.");
  }
  if (!config.PUBLIC_BASE_URL) {
    throw new Error("PUBLIC_BASE_URL is required for Modal lip-sync callbacks.");
  }

  const audioUrl = req.audioUri ?? req.audioUrl;
  const videoUrl = req.videoUrl;
  if (!audioUrl) throw new Error("Lip-sync requires an audio URL.");
  if (!videoUrl) throw new Error("Lip-sync requires a performance video URL.");

  const prompt = (req.promptText ?? req.prompt ?? "A performer sings naturally to the supplied vocal performance.").trim();
  const referenceStrength = Math.min(1.5, Math.max(0, Number(req.referenceStrength ?? 1)));
  const jobId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  await writeJobToDisk(jobId, {
    status: "pending",
    prompt,
    createdAt: now,
    updatedAt: now,
  });

  try {
    const [videoMedia, audioMedia] = await Promise.all([
      modalMediaPayload(videoUrl, "video"),
      modalMediaPayload(audioUrl, "audio"),
    ]);
    const webhookUrl = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/modal/webhook`;

    const response = await fetch(config.MODAL_LIPSYNC_URL, {
      method: "POST",
      headers: modalHeaders(),
      body: JSON.stringify({
        ...videoMedia,
        ...audioMedia,
        prompt,
        reference_strength: referenceStrength,
        audio_start: req.audioStart ?? 0,
        audio_end: req.audioEnd,
        avatar_id: req.avatarId,
        job_id: jobId,
        webhook_url: webhookUrl,
      }),
      signal: AbortSignal.timeout(120_000),
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(await responseError(response));
    }

    const accepted = (await response.json().catch(() => ({}))) as { call_id?: string };
    await writeJobToDisk(jobId, {
      status: "running",
      prompt,
      createdAt: now,
      updatedAt: Date.now(),
      modalCallId: accepted.call_id,
    });
    return { id: encodeTaskId({ source: "modal", id: jobId }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(jobId, {
      status: "failed",
      prompt,
      error: message,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw new Error(`Could not start LTX-2.3 LipDub: ${message}`);
  }
}
