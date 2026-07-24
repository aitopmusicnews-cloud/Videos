import { useEffect, useMemo, useState } from "react";
import { useStore, MAX_CLIP_LEN } from "../lib/store.js";
import type { Clip, Task } from "@mvs/shared";
import { enqueueGeneration } from "../lib/scheduler.js";
import {
  extractLastFrame,
  pollTask,
  startLipSync,
  startTextToImage,
} from "../lib/api.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";

type LtxSource = "textToVideo" | "imageToVideo" | "continue";

type LipSyncProgress = {
  percent: number;
  stage: number;
  totalStages: number;
  title: string;
  detail: string;
  status: "running" | "complete" | "failed";
};

const LIP_SYNC_STAGES = [
  {
    afterMs: 0,
    percent: 5,
    title: "Submitting LipDub job",
    detail: "Sending the performance clip and matching song section to Render.",
  },
  {
    afterMs: 3_000,
    percent: 12,
    title: "Starting Modal GPU",
    detail: "Waiting for an A100 worker and validating the cached LTX-2.3 models.",
  },
  {
    afterMs: 20_000,
    percent: 24,
    title: "Preparing media",
    detail: "Reading the source clip and slicing the exact matching section of the song.",
  },
  {
    afterMs: 45_000,
    percent: 36,
    title: "Loading Gemma",
    detail: "Building the text encoder and creating prompt conditioning.",
  },
  {
    afterMs: 90_000,
    percent: 50,
    title: "Analyzing the performance",
    detail: "Encoding the face, mouth movement, reference video, and replacement audio.",
  },
  {
    afterMs: 150_000,
    percent: 64,
    title: "LipDub generation · pass 1",
    detail: "Generating synchronized facial and mouth movement from the vocal performance.",
  },
  {
    afterMs: 300_000,
    percent: 78,
    title: "LipDub generation · pass 2",
    detail: "Refining identity, motion, timing, and temporal consistency.",
  },
  {
    afterMs: 480_000,
    percent: 90,
    title: "Rendering the video",
    detail: "Decoding frames, combining the synchronized audio, and writing the MP4.",
  },
  {
    afterMs: 720_000,
    percent: 96,
    title: "Finalizing",
    detail: "Uploading the finished clip and waiting for the completion callback.",
  },
] as const;

const SOURCES: Array<{ value: LtxSource; label: string; desc: string }> = [
  {
    value: "textToVideo",
    label: "Text → Video",
    desc: "Create synchronized video and audio directly from one scene prompt.",
  },
  {
    value: "imageToVideo",
    label: "Image → Video",
    desc: "Animate a reference frame while LTX-2.3 generates matching motion and audio.",
  },
  {
    value: "continue",
    label: "Continue Previous Clip",
    desc: "Use the previous clip's last frame as the first frame of this generation.",
  },
];

const MOTION_PRESETS = [
  { label: "Dolly In", text: "slow dolly-in toward the subject, 35mm lens" },
  { label: "Orbit", text: "smooth orbital camera move around the subject" },
  { label: "Crane Up", text: "camera cranes upward to reveal the environment" },
  { label: "Drone Sweep", text: "wide cinematic aerial sweep with atmospheric depth" },
  { label: "Low Angle", text: "low-angle tracking shot with a heroic perspective" },
  { label: "Macro", text: "extreme macro close-up with shallow depth of field" },
  { label: "Whip Pan", text: "fast whip-pan transition with energetic motion blur" },
  { label: "Handheld", text: "natural handheld camera movement with controlled shake" },
];

function normalizeSource(source: string): LtxSource {
  if (source === "continue") return "continue";
  if (source === "imageToVideo" || source === "archetype") return "imageToVideo";
  return "textToVideo";
}

function taskOutputUrl(task: Task): string | undefined {
  if (task.outputUrl) return task.outputUrl;
  if (Array.isArray(task.output)) return task.output[0];
  return task.output?.videoUrl ?? task.output?.imageUrl ?? task.output?.url;
}

function estimatedLipSyncProgress(elapsedMs: number): LipSyncProgress {
  let index = 0;
  for (let i = 1; i < LIP_SYNC_STAGES.length; i += 1) {
    if (elapsedMs >= LIP_SYNC_STAGES[i]!.afterMs) index = i;
    else break;
  }

  const current = LIP_SYNC_STAGES[index]!;
  const next = LIP_SYNC_STAGES[index + 1];
  let percent = current.percent;
  if (next) {
    const span = Math.max(1, next.afterMs - current.afterMs);
    const fraction = Math.min(1, Math.max(0, (elapsedMs - current.afterMs) / span));
    percent = Math.min(next.percent - 1, Math.round(current.percent + fraction * (next.percent - current.percent)));
  } else {
    percent = Math.min(98, current.percent + Math.floor((elapsedMs - current.afterMs) / 120_000));
  }

  return {
    percent,
    stage: index + 1,
    totalStages: LIP_SYNC_STAGES.length,
    title: current.title,
    detail: current.detail,
    status: "running",
  };
}

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const audioUrl = useStore((s) => s.audioUrl);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const updateClip = useStore((s) => s.updateClip);

  const [extracting, setExtracting] = useState(false);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [characterPrompt, setCharacterPrompt] = useState("");
  const [lipSyncing, setLipSyncing] = useState(false);
  const [lipSyncProgress, setLipSyncProgress] = useState<LipSyncProgress | null>(null);
  const [referenceStrength, setReferenceStrength] = useState(1);
  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);
  const source = normalizeSource(clip?.source ?? "textToVideo");

  useEffect(() => {
    if (clip && clip.source !== source && clip.status !== "ready" && clip.source !== "lipSync") {
      updateClip(clip.id, { source, model: "ltx-video" });
    }
  }, [clip?.id, clip?.source, clip?.status, source, updateClip]);

  if (!clip || !analysis) return null;

  const sections = analysis.sections ?? [];
  const rmsCurve = analysis.rmsCurve ?? [];
  const analysisDuration = analysis.duration ?? Math.max(clip.end, 1);
  const section = sections.find((s) => (s.start ?? 0) <= clip.start && (s.end ?? 0) >= clip.end);
  const sectionLabel = section?.label ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(rmsCurve, clip.start, clip.end, analysisDuration);
  const prompt = clip.prompt ?? "";
  const cameraPrompt = (clip as Clip & { cameraPrompt?: string }).cameraPrompt ?? "";

  const clipIdx = clips.findIndex((c) => c.id === clip.id);
  const hasPrev = clipIdx > 0 && clips[clipIdx - 1]?.status === "ready";
  const selectedImage = clip.archetypeUrl ?? lookbook[0];

  const setSource = (next: LtxSource) => {
    updateClip(clip.id, {
      source: next,
      model: "ltx-video",
      lastError: undefined,
    });
  };

  const canGenerate = checkCanGenerate(source, {
    prompt,
    selectedImage,
    hasPrev,
  });

  const onGenerate = () => {
    if (!canGenerate.ok) {
      toast.warning(canGenerate.reason);
      return;
    }

    const fullPrompt = [prompt.trim(), cameraPrompt.trim()]
      .filter(Boolean)
      .join(". Camera direction: ");

    enqueueGeneration({
      clipId: clip.id,
      source,
      seedImageUrl: source === "imageToVideo" ? selectedImage ?? "" : "",
      prompt: fullPrompt,
      duration: durationSec,
      sectionLabel,
      energy,
      model: "ltx-video",
    });
  };

  const onCreateCharacter = async () => {
    const text = characterPrompt.trim();
    if (!text) {
      toast.warning("Describe the artist or reference frame first");
      return;
    }
    setCreatingCharacter(true);
    try {
      const result = await startTextToImage({
        promptText: text,
        ratio: "16:9",
        model: "sdxl",
      }) as unknown as { imageUrl: string };
      if (!result.imageUrl) throw new Error("The image service returned no image URL");
      addLookbook(result.imageUrl);
      updateClip(clip.id, { archetypeUrl: result.imageUrl });
      toast.success("Character reference created and selected");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast.error(`Character generation failed: ${reason.slice(0, 120)}`);
    } finally {
      setCreatingCharacter(false);
    }
  };

  const onLipSync = async () => {
    if (!clip.videoUrl || clip.status !== "ready") {
      toast.warning("Generate or upload a performance clip before lip-syncing");
      return;
    }
    if (!audioUrl) {
      toast.warning("Load the song before lip-syncing");
      return;
    }

    const referenceVideoUrl = clip.videoUrl;
    const previousSource = clip.source;
    const startedAt = Date.now();
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    setLipSyncing(true);
    setLipSyncProgress(estimatedLipSyncProgress(0));
    progressTimer = setInterval(() => {
      setLipSyncProgress(estimatedLipSyncProgress(Date.now() - startedAt));
    }, 1000);

    try {
      toast.info("Preparing the matching song segment for LipDub…");
      updateClip(clip.id, {
        status: "generating",
        generationTaskId: undefined,
        lastError: undefined,
      });

      const task = await startLipSync({
        videoUrl: referenceVideoUrl,
        audioUrl,
        audioStart: clip.start,
        audioEnd: clip.end,
        promptText: prompt.trim() || "The performer sings naturally to the supplied vocal performance with accurate mouth movement and stable identity.",
        referenceStrength,
        model: "ltx-2.3-lipdub",
      });
      updateClip(clip.id, { generationTaskId: task.id });

      const final = await pollTask(task.id, 3000, 1_800_000);
      const outputUrl = taskOutputUrl(final);
      if ((final.status || "").toUpperCase() !== "SUCCEEDED" || !outputUrl) {
        throw new Error(final.error ?? `LipDub ended in ${final.status}`);
      }

      setLipSyncProgress({
        percent: 100,
        stage: LIP_SYNC_STAGES.length,
        totalStages: LIP_SYNC_STAGES.length,
        title: "LipDub complete",
        detail: "The synchronized performance clip is ready to preview and save.",
        status: "complete",
      });
      updateClip(clip.id, {
        videoUrl: outputUrl,
        source: "lipSync",
        model: "ltx-2.3-lipdub",
        status: "ready",
        generationTaskId: undefined,
        lastError: undefined,
      });
      toast.success("LTX-2.3 LipDub clip ready");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setLipSyncProgress((current) => ({
        percent: current?.percent ?? 0,
        stage: current?.stage ?? 1,
        totalStages: LIP_SYNC_STAGES.length,
        title: "LipDub failed",
        detail: reason,
        status: "failed",
      }));
      updateClip(clip.id, {
        videoUrl: referenceVideoUrl,
        source: previousSource,
        status: "ready",
        generationTaskId: undefined,
        lastError: reason,
      });
      toast.error(`Lip-sync failed: ${reason.slice(0, 140)}`);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setLipSyncing(false);
    }
  };

  const onExtractFrame = async () => {
    if (!clip.videoUrl) return;
    setExtracting(true);
    try {
      const { url } = await extractLastFrame(clip.videoUrl);
      addLookbook(url);
      toast.success("Last frame added to reference images");
    } catch {
      toast.error("Could not extract the last frame");
    } finally {
      setExtracting(false);
    }
  };

  const promptLabel =
    source === "textToVideo"
      ? "Scene + audio prompt"
      : source === "imageToVideo"
        ? "Motion + audio prompt"
        : "Continuation + audio prompt";

  const showLipSyncPanel = !!clip.videoUrl && (clip.status === "ready" || lipSyncing);

  return (
    <>
      <div className="sidebar-header-row">
        <span className="pill">LTX-2.3</span>
        <span className="meta">{durationSec.toFixed(1)}s · {clip.id}</span>
      </div>

      <div className="ltx-engine-card">
        <div className="ltx-engine-title">Complete Music Video Stack</div>
        <div className="ltx-engine-meta">LTX-2.3 video + audio · character frames · LipDub · Modal GPU</div>
      </div>

      <div className="option-group">
        <div className="label">Create artist / reference frame</div>
        <textarea
          className="prompt compact"
          placeholder="Describe the artist, wardrobe, face, location, lighting, and camera framing…"
          value={characterPrompt}
          onChange={(e) => setCharacterPrompt(e.target.value)}
        />
        <button
          type="button"
          className="btn ghost w-full"
          onClick={onCreateCharacter}
          disabled={creatingCharacter}
        >
          {creatingCharacter ? "Creating reference…" : "Generate character reference"}
        </button>
        <div className="select-desc">The result is added to your reference images and selected for this clip.</div>
      </div>

      <div className="option-group">
        <div className="label">Generation mode</div>
        <div className="select-wrap">
          <select
            className="select"
            value={source}
            onChange={(e) => setSource(e.target.value as LtxSource)}
          >
            {SOURCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="select-chevron">▾</span>
        </div>
        <div className="select-desc">{SOURCES.find((item) => item.value === source)?.desc}</div>
      </div>

      {source === "imageToVideo" && (
        <div className="option-group">
          <div className="label">First-frame reference</div>
          <ImageSeedGrid
            lookbook={lookbook}
            selectedUrl={clip.archetypeUrl}
            onPick={(url) => updateClip(clip.id, { archetypeUrl: url })}
            onClear={() => updateClip(clip.id, { archetypeUrl: undefined })}
          />
          <div className="select-desc">Upload, generate, or select one image. LTX-2.3 animates it as frame one.</div>
        </div>
      )}

      {source === "continue" && (
        <div className={`continuity-status${hasPrev ? " ready" : " blocked"}`}>
          <strong>{hasPrev ? "Previous frame ready" : "Previous clip required"}</strong>
          <span>
            {hasPrev
              ? "The last frame of the previous generated clip will be used automatically."
              : "Generate the clip immediately to the left before continuing this one."}
          </span>
        </div>
      )}

      <div className="option-group">
        <div className="label">{promptLabel}</div>
        <textarea
          className="prompt"
          placeholder="Describe the subject, action, setting, camera, dialogue, ambience, music, and sound effects…"
          value={prompt}
          onChange={(e) => updateClip(clip.id, { prompt: e.target.value })}
        />
        <div className="select-desc">
          LTX-2.3 creates picture and sound together. Include dialogue in quotes and describe ambience or effects explicitly.
        </div>
      </div>

      <div className="option-group">
        <div className="label">Camera direction</div>
        <textarea
          className="prompt compact"
          placeholder="Example: slow push-in, eye-level 35mm lens, subject centered…"
          value={cameraPrompt}
          onChange={(e) => updateClip(clip.id, { cameraPrompt: e.target.value } as Partial<Clip>)}
        />
        <div className="motion-presets">
          {MOTION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="model-chip"
              onClick={() => {
                const next = cameraPrompt
                  ? `${cameraPrompt}, ${preset.text}`
                  : preset.text;
                updateClip(clip.id, { cameraPrompt: next } as Partial<Clip>);
              }}
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="option-group">
        <div className="label">Clip context</div>
        <div className="context-card">
          <div className="row"><span>Song section</span><span>{sectionLabel}</span></div>
          <div className="row"><span>Energy</span><span>{energy.toFixed(2)}</span></div>
          <div className="row"><span>Duration</span><span>{durationSec.toFixed(2)}s / {MAX_CLIP_LEN}s</span></div>
          <div className="row"><span>Audio</span><span>Generated or song-synced</span></div>
        </div>
      </div>

      {showLipSyncPanel && (
        <div className="option-group">
          <div className="label">Performance lip-sync</div>
          <div className="select-desc">
            Uses this video as the performance reference and automatically slices the matching part of your song.
          </div>
          <label className="label" htmlFor="lipdub-strength">Identity / motion strength · {referenceStrength.toFixed(2)}</label>
          <input
            id="lipdub-strength"
            type="range"
            min="0.5"
            max="1.25"
            step="0.05"
            value={referenceStrength}
            onChange={(e) => setReferenceStrength(Number(e.target.value))}
            disabled={lipSyncing}
          />

          {lipSyncProgress && (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                background: "rgba(255,255,255,0.035)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                <strong>
                  {lipSyncProgress.status === "complete"
                    ? "Complete"
                    : lipSyncProgress.status === "failed"
                      ? `Stopped at stage ${lipSyncProgress.stage}`
                      : `Stage ${lipSyncProgress.stage} of ${lipSyncProgress.totalStages}`}
                </strong>
                <span>{lipSyncProgress.percent}%</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700 }}>{lipSyncProgress.title}</div>
              <div
                style={{
                  height: 8,
                  marginTop: 10,
                  overflow: "hidden",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.1)",
                }}
              >
                <div
                  style={{
                    width: `${lipSyncProgress.percent}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: lipSyncProgress.status === "failed"
                      ? "#ef4444"
                      : lipSyncProgress.status === "complete"
                        ? "#22c55e"
                        : "linear-gradient(90deg, #6366f1, #a855f7)",
                    transition: "width 700ms ease",
                  }}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.45, opacity: 0.72 }}>
                {lipSyncProgress.detail}
              </div>
              {lipSyncProgress.status === "running" && (
                <div style={{ marginTop: 6, fontSize: 10, opacity: 0.5 }}>
                  Estimated stage based on elapsed processing time. Completion is confirmed by the Modal callback.
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="generate-btn"
            onClick={onLipSync}
            disabled={lipSyncing || !audioUrl}
          >
            {lipSyncing ? "Lip-syncing with LTX-2.3…" : "Lip-sync this clip to the song"}
          </button>
        </div>
      )}

      {clip.status === "ready" && clip.videoUrl && (
        <div className="option-group">
          <button
            type="button"
            className="btn ghost w-full"
            onClick={onExtractFrame}
            disabled={extracting}
          >
            {extracting ? "Extracting frame…" : "Save last frame as reference"}
          </button>
        </div>
      )}

      {clip.lastError && (
        <div className="error-card">
          <div className="error-title">Last operation</div>
          <div className="error-message">{clip.lastError}</div>
        </div>
      )}

      <div className="sidebar-footer">
        <button
          className="generate-btn"
          onClick={onGenerate}
          disabled={clip.status === "queued" || clip.status === "generating" || !canGenerate.ok}
          title={canGenerate.ok ? undefined : canGenerate.reason}
        >
          {clip.status === "queued"
            ? "Queued…"
            : clip.status === "generating"
              ? "Generating with LTX-2.3…"
              : clip.status === "failed"
                ? "Retry LTX-2.3"
                : clip.status === "ready"
                  ? "Regenerate with LTX-2.3"
                  : "Generate with LTX-2.3"}
        </button>

        {(clip.videoUrl || clip.status !== "empty") && (
          <button
            type="button"
            className="btn ghost clear-clip-btn"
            onClick={() => {
              if (clip.status === "ready" && !confirm("Clear this clip's generated video? The prompt will be kept.")) return;
              updateClip(clip.id, {
                status: "empty",
                videoUrl: undefined,
                thumbnailUrl: undefined,
                generationTaskId: undefined,
                lastError: undefined,
              });
              setLipSyncProgress(null);
            }}
          >
            Clear clip
          </button>
        )}
      </div>
    </>
  );
}

type CanGenerate = { ok: true; reason?: string } | { ok: false; reason: string };

function checkCanGenerate(
  source: LtxSource,
  context: { prompt: string; selectedImage?: string; hasPrev: boolean },
): CanGenerate {
  if (!context.prompt.trim()) {
    return { ok: false, reason: "Describe the scene and audio before generating" };
  }
  if (source === "imageToVideo" && !context.selectedImage) {
    return { ok: false, reason: "Select or upload a first-frame reference image" };
  }
  if (source === "continue" && !context.hasPrev) {
    return { ok: false, reason: "Generate the previous clip first" };
  }
  return { ok: true };
}

function ImageSeedGrid({
  lookbook,
  selectedUrl,
  onPick,
  onClear,
}: {
  lookbook: string[];
  selectedUrl: string | undefined;
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  const customUrl = selectedUrl && !lookbook.includes(selectedUrl) ? selectedUrl : null;
  const images = customUrl ? [...lookbook, customUrl] : lookbook;
  const active = selectedUrl ?? lookbook[0];

  return (
    <div className="archetype-grid">
      {images.map((url) => {
        const isCustom = url === customUrl;
        return (
          <div key={url} className={`archetype-tile-wrap${isCustom ? " custom" : ""}`}>
            <button
              type="button"
              className={`archetype-tile${active === url ? " selected" : ""}`}
              style={{ backgroundImage: `url(${url})` }}
              onClick={() => onPick(url)}
              aria-label="Select first-frame reference"
            />
            {isCustom && (
              <button
                type="button"
                className="archetype-clear"
                onClick={onClear}
                aria-label="Remove custom reference"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <AssetUploader className="archetype-tile add" onUploaded={onPick}>
        <span className="tile-add-label">+</span>
      </AssetUploader>
      {images.length === 0 && (
        <div className="archetype-empty">Add the first image that LTX-2.3 should animate.</div>
      )}
    </div>
  );
}

function avgRms(curve: number[], start: number, end: number, duration: number): number {
  if (!curve.length) return 0;
  const i0 = Math.max(0, Math.floor((start / duration) * curve.length));
  const i1 = Math.min(curve.length, Math.ceil((end / duration) * curve.length));
  if (i1 <= i0) return curve[i0] ?? 0;
  let total = 0;
  for (let i = i0; i < i1; i++) total += curve[i] ?? 0;
  return total / (i1 - i0);
}
