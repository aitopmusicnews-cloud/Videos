import { useEffect, useMemo, useState } from "react";
import { useStore, MAX_CLIP_LEN } from "../lib/store.js";
import type { Clip } from "@mvs/shared";
import { enqueueGeneration } from "../lib/scheduler.js";
import { extractLastFrame } from "../lib/api.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";

type LtxSource = "textToVideo" | "imageToVideo" | "continue";

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

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const updateClip = useStore((s) => s.updateClip);

  const [extracting, setExtracting] = useState(false);
  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);
  const source = normalizeSource(clip?.source ?? "textToVideo");

  useEffect(() => {
    if (clip && clip.source !== source && clip.status !== "ready") {
      updateClip(clip.id, { source, model: "ltx-video" });
    }
  }, [clip?.id, clip?.source, clip?.status, source, updateClip]);

  if (!clip || !analysis) return null;

  const section = analysis.sections.find((s) => s.start <= clip.start && s.end >= clip.end);
  const sectionLabel = section?.label ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(analysis.rmsCurve, clip.start, clip.end, analysis.duration);
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

  return (
    <>
      <div className="sidebar-header-row">
        <span className="pill">LTX-2.3</span>
        <span className="meta">{durationSec.toFixed(1)}s · {clip.id}</span>
      </div>

      <div className="ltx-engine-card">
        <div className="ltx-engine-title">LTX-2.3 Distilled</div>
        <div className="ltx-engine-meta">768×512 · 24 FPS · native synchronized audio · Modal A100</div>
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
          <div className="select-desc">Upload or select one image. LTX-2.3 animates it as frame one.</div>
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
          <div className="row"><span>Audio</span><span>Generated with video</span></div>
        </div>
      </div>

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

      {clip.status === "failed" && clip.lastError && (
        <div className="error-card">
          <div className="error-title">Generation failed</div>
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
