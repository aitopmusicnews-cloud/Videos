import type {
  ImageToVideoRequest,
  TextToImageRequest,
  LipSyncRequest,
} from "@mvs/shared";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";

export interface JobRecord {
  status: 'pending' | 'completed' | 'failed';
  video_url?: string;
  error?: string;
  prompt: string;
  createdAt: number;
}

const PUBLIC_API_URL = config.PUBLIC_BASE_URL || 'https://rendernodock.onrender.com';

/**
 * File-backed Persistent Database Helpers
 */
const getJobsDir = () => join(config.STORAGE_DIR, "jobs");

async function ensureJobsDir() {
  await mkdir(getJobsDir(), { recursive: true }).catch(() => {});
}

export async function writeJobToDisk(jobId: string, record: JobRecord): Promise<void> {
  await ensureJobsDir();
  const filePath = join(getJobsDir(), `${jobId}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
}

export async function readJobFromDisk(jobId: string): Promise<JobRecord | null> {
  const filePath = join(getJobsDir(), `${jobId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as JobRecord;
  } catch (err) {
    console.error(`[DB Error] Failed to read job ${jobId} from file:`, err);
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
    const str = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(str);
    if (parsed && parsed.id) return parsed;
  } catch (e) {}
  return { source: "modal", id: encoded };
}

/**
 * Async Webhook Generation Launcher for Modal LTX-Video
 */
export async function imageToVideo(req: ImageToVideoRequest): Promise<ModalTask> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  let promptToUse = req.promptText ?? "";
  
  await writeJobToDisk(jobId, { status: 'pending', prompt: promptToUse, createdAt: Date.now() });

  const webhookUrl = `${PUBLIC_API_URL}/api/modal/webhook`;
  
  const response = await fetch(config.MODAL_LTX_URL || 'https://modal.run', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: promptToUse,
      // FIXED: Maps your app's actual promptImage property to the backend payload
      image_url: req.promptImage || undefined,
      job_id: jobId,
      webhook_url: webhookUrl
    })
  });

  if (!response.ok) {
    throw new Error(`Modal LTX pipeline rejected request: ${response.statusText}`);
  }

  return { id: encodeTaskId({ source: "modal", id: jobId }) };
}

/**
 * Native Text to Image Character Generation via Media Suite SDXL
 */
export async function generateCharacterFrame(req: TextToImageRequest): Promise<{ imageUrl: string }> {
  const response = await fetch(config.MODAL_MEDIA_SUITE_URL || 'https://cdtfullsail--mvs-media-suite-text-to-image.modal.run', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: req.promptText,
      aspect_ratio: "16:9"
    })
  });

  if (!response.ok) {
    throw new Error(`Modal SDXL engine failed: ${response.statusText}`);
  }

  const data = await response.json() as { url: string };
  return { imageUrl: data.url };
}

/**
 * Character Lip Sync Studio Core Connector
 */
export async function animateLipSync(req: LipSyncRequest): Promise<ModalTask> {
  const jobId = `sync_${Date.now()}`;
  
  const response = await fetch(config.MODAL_LIPSYNC_URL || 'https://modal.run', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // FIXED: Swapped audioUrl to audioUri to match your frontend type
      audio_url: req.audioUri,
      video_url: req.videoUrl,
      job_id: jobId
    })
  });

  if (!response.ok) {
    throw new Error(`Modal Lip-Sync service rejected request: ${response.statusText}`);
  }

  return { id: encodeTaskId({ source: "modal", id: jobId }) };
}
