import { z } from "zod";

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export function modelSupportsBridge(model: string): boolean {
  return model === "ltx-video" || model === "runway-gen3";
}

export type GenerationModel = "ltx-video" | "runway-gen3" | "wan2.1" | "hunyuan" | string;
export type TextToImageModel = "sdxl" | "flux" | "wan2.1" | "openrouter_image_ultra" | "openrouter_image_flash" | "local_wan21_image" | "gpt_image_2" | "gemini_image3_pro" | string;
export type TextToImageRatio = "16:9" | "9:16" | "1:1" | "4:3" | string;

export const AudioSectionSchema = z.object({
  label: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
}).passthrough();
export type AudioSection = z.infer<typeof AudioSectionSchema>;

export const AudioAnalysis = z.object({
  bpm: z.number().optional(),
  duration: z.number().optional(),
  beats: z.array(z.number()).optional(),
  bars: z.array(z.number()).optional(),
  downbeats: z.array(z.number()).optional(),
  key: z.string().optional(),
  rmsCurve: z.array(z.number()).optional(),
  sections: z.array(AudioSectionSchema).optional(),
}).passthrough();
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;

export const ClipSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  source: z.string(),
  status: z.enum(["empty", "queued", "generating", "ready", "failed"]),
  prompt: z.string().optional(),
  imagePrompt: z.string().optional(),
  seedImageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  model: z.string().optional(),
  generationTaskId: z.string().optional(),
  sectionLabel: z.string().optional(),
  error: z.string().optional(),
  lastError: z.string().optional(),
  archetypeUrl: z.string().optional(),
  bridge: z.boolean().optional(),
  enableAudio: z.boolean().optional(),
}).passthrough();
export type Clip = z.infer<typeof ClipSchema>;

export const ProjectSnapshot = z.object({
  projectId: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  songId: z.string().nullable().optional(),
  songName: z.string().nullable().optional(),
  songFilename: z.string().nullable().optional(),
  audioUrl: z.string().nullable().optional(),
  vocalAudioUrl: z.string().nullable().optional(),
  analysis: AudioAnalysis.nullable().optional(),
  clips: z.array(ClipSchema).optional(),
  selectedClipId: z.string().nullable().optional(),
  characterImageUrl: z.string().nullable().optional(),
  avatarId: z.string().nullable().optional(),
  avatarName: z.string().nullable().optional(),
  lookbook: z.array(z.string()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
}).passthrough();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshot>;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  savedAt?: string;
  thumbnailUrl?: string;
}

export interface SavedProject {
  id?: string;
  meta: ProjectMeta;
  name?: string;
  savedAt?: string;
  thumbnailUrl?: string;
  files?: Record<string, unknown>[];
  state?: Record<string, unknown>;
  snapshot: Record<string, unknown>;
}

export interface SavedClip {
  id: string;
  name: string;
  videoUrl: string;
  source: string;
  prompt: string | null;
  duration: number;
  sectionLabel: string | null;
  folderId?: string | null;
  model?: string | null;
  generationTaskId?: string | null;
  createdAt?: string;
  savedAt?: string;
}

export interface SavedImage {
  id: string;
  name: string;
  url: string;
  source: string;
  prompt: string | null;
  model: string | null;
  folderId?: string | null;
  createdAt?: string;
  savedAt?: string;
}

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  type: "clips" | "images";
  createdAt?: string;
}

export interface RenderEntry {
  id: string;
  name?: string;
  url: string;
  duration?: number;
  size?: number;
  modifiedAt?: string;
  createdAt?: string;
}

export interface Task {
  id: string;
  status:
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";
  progress?: number;
  outputUrl?: string;
  output?: string[] | { videoUrl?: string; imageUrl?: string; url?: string };
  error?: string;
}

export const TextToImageRequest = z.object({
  prompt: z.string().optional(),
  promptText: z.string().optional(),
  ratio: z.string().optional(),
  model: z.string().optional(),
}).passthrough();
export type TextToImageRequest = z.infer<typeof TextToImageRequest>;

export const ImageToVideoRequest = z.object({
  prompt: z.string().optional(),
  promptText: z.string().optional(),
  imageUrl: z.string().optional(),
  promptImage: z.string().optional(),
  promptImageEnd: z.string().optional(),
  duration: z.number().optional(),
  model: z.string().optional(),
  ratio: z.string().optional(),
  aspectRatio: z.string().optional(),
}).passthrough();
export type ImageToVideoRequest = z.infer<typeof ImageToVideoRequest>;

export const VideoToVideoRequest = z.object({
  prompt: z.string().optional(),
  videoUrl: z.string().optional(),
  videoUri: z.string().optional(),
  model: z.string().optional(),
}).passthrough();
export type VideoToVideoRequest = z.infer<typeof VideoToVideoRequest>;

export const LipSyncRequest = z.object({
  imageUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  audioUri: z.string().optional(),
  videoUrl: z.string().optional(),
  avatarId: z.string().optional(),
  model: z.string().optional(),
}).passthrough();
export type LipSyncRequest = z.infer<typeof LipSyncRequest>;

export const TextToVideoRequest = z.object({
  prompt: z.string().optional(),
  promptText: z.string().optional(),
  duration: z.number().optional(),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
}).passthrough();
export type TextToVideoRequest = z.infer<typeof TextToVideoRequest>;
