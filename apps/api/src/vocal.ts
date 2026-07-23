import { config } from "./config.js";
import { encodeTaskId, type ModalTask } from "./modalAI.js";

interface ModalAudioResponse {
  duration: number;
  bpm: number;
  key: string;
  beats: number[];
  downbeats: number[];
  onsets: number[];
  rms_curve: number[];
  sections: Array<{ start: number; end: number; label: string }>;
}

/**
 * Core Vocal Track Analyzer connecting directly to Modal cloud workspace
 */
export async function analyzeVocalTrack(audioUrl: string): Promise<ModalTask> {
  const jobId = `audio_${Date.now()}`;
  
  const response = await fetch(config.MODAL_AUDIO_URL || 'https://modal.run', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: audioUrl, job_id: jobId })
  });

  if (!response.ok) {
    throw new Error(`Modal audio analyzer rejected track payload: ${response.statusText}`);
  }

  // FIXED: Cast explicitly to the type-safe contract to clear strict compiler flags
  const result = (await response.json()) as ModalAudioResponse;

  console.log(`[Audio Pipeline Success] Analyzed ${result.duration}s track. Key: ${result.key}, BPM: ${result.bpm}`);

  return { id: encodeTaskId({ source: "modal", id: jobId }) };
}
