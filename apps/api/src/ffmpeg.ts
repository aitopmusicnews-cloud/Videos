import { spawn } from "node:child_process";

// 20 minutes — covers the full-timeline render queue worker for big projects
// (15+ min songs, 30+ clips). The shorter ffmpeg jobs (frame extract, audio
// slice) finish in seconds and never approach the cap.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Probe a video's container duration via ffprobe. Used by the renderer to
 * time-stretch each clip into its timeline slot — without this we get
 * frozen tails (source < slot) or popped-out tails (source > slot).
 */
export function probeDuration(url: string, timeoutMs = 30_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      url,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffprobe failed (exit ${code}): ${stderr.slice(-500)}`));
        return;
      }
      const dur = parseFloat(stdout.trim());
      if (!Number.isFinite(dur) || dur <= 0) {
        reject(new Error(`ffprobe returned non-finite duration: ${stdout}`));
        return;
      }
      resolve(dur);
    });
  });
}

/**
 * Carries ffmpeg's stderr without exposing it through `.message` (which the
 * global error handler returns to the client). Pino logs the full object, so
 * stderr lands in server logs while clients see a generic message.
 */
export class FfmpegError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = "FfmpegError";
    this.stderr = stderr;
  }
}

export function runFfmpeg(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const tail = stderr.slice(-2000);
      if (timedOut) reject(new FfmpegError("ffmpeg timed out", tail));
      else if (code === 0) resolve();
      else reject(new FfmpegError(`ffmpeg failed (exit ${code})`, tail));
    });
  });
}
