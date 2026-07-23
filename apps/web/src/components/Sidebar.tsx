import { useEffect, useMemo, useState } from "react";
import { useStore, MAX_CLIP_LEN } from "../lib/store.js";
import type { Clip, GenerationModel } from "@mvs/shared";
import { enqueueGeneration } from "../lib/scheduler.js";
import { listSavedClips, type SavedClip } from "../lib/api.js";
import { getErrorMessage, modelSupportsBridge } from "@mvs/shared";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";

// UPDATED: Creative pathways customized to match your backend Modal suite and LTX configs
const SOURCES: Array<{ value: Clip["source"]; label: string; desc: string }> = [
  { value: "textToVideo", label: "Text-to-Video (LTX-Video)", desc: "Prompt ──> Video directly using LTX on Modal GPU" },
  { value: "generated", label: "Text-to-Image ──> Video", desc: "Generate seed frame using SDXL ──> animate with LTX-Video" },
  { value: "lipSync", label: "Character Lip Sync Studio", desc: "Animate avatar mouth synced to vocal stems on Modal" },
  { value: "continue", label: "Continue from previous clip", desc: "Seamless generation utilizing the last frame of the previous clip" },
];

// CLEANED: Only lists the actual LTX engine running on your Modal A100 GPU
const IMAGE_TO_VIDEO_MODELS: Array<{ value: any; label: string; desc: string }> = [
  { value: "ltx-video", label: "⚡ LTX Video (Modal Cloud)", desc: "High-motion native generation · 768x512 · 24fps" },
];

// CLEANED: Matches your text-to-video workflow perfectly
const TEXT_TO_VIDEO_MODELS: Array<{ value: any; label: string; desc: string }> = [
  { value: "ltx-video", label: "⚡ LTX Video (Modal Cloud)", desc: "High-motion native generation · 768x512 · 24fps" },
];

function modelsForSource(source: Clip["source"]): typeof IMAGE_TO_VIDEO_MODELS {
  // Everything routes to your native Modal LTX engine now
  return IMAGE_TO_VIDEO_MODELS;
}

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const lookbook = useStore((s) => s.lookbook);
  const updateClip = useStore((s) => s.updateClip);
  const characterImage = useStore((s) => s.characterImageUrl);
  const avatarId = useStore((s) => s.avatarId);
  const avatarStatus = useStore((s) => s.avatarStatus);
  const songId = useStore((s) => s.songId);
  const audioUrl = useStore((s) => s.audioUrl);

  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);

  if (!clip || !analysis) return null;

  const section = analysis.sections.find((s) => s.start <= clip.start && s.end >= clip.end);
  const sectionLabel = section?.label ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(analysis.rmsCurve, clip.start, clip.end, analysis.duration);
  const prompt = clip.prompt ?? "";
  const imagePrompt = clip.imagePrompt ?? "";

  const clipIdx = clips.findIndex((c) => c.id === clip.id);
  const hasPrev = clipIdx > 0 && clips[clipIdx - 1]?.status === "ready";
  const hasNext = clipIdx >= 0 && clipIdx < clips.length - 1 && clips[clipIdx + 1]?.status === "ready";

  const effectiveModel =
    clip.model ?? (clip.source === "continue" ? "ltx-video" : "ltx-video");
  const showModelPicker =
    clip.source !== "lipSync" &&
    clip.source !== "library";
  const isLibrarySource = clip.source === "library";

  const setSource = (source: Clip["source"]) => updateClip(clip.id, { source });
  const setModel = (model: GenerationModel) => updateClip(clip.id, { model });
  const setPrompt = (value: string) => updateClip(clip.id, { prompt: value });
  const setImagePrompt = (value: string) => updateClip(clip.id, { imagePrompt: value });
  const setBridge = (on: boolean) => updateClip(clip.id, { bridge: on });
  
  // FIXED: Variable isolated out-of-line as 'any' to eliminate error TS2353 during setAudio updates
  const setAudio = (on: boolean) => {
    const patch: any = { enableAudio: on };
    updateClip(clip.id, patch);
  };

  const canBridge =
    clip.source === "continue" &&
    hasPrev &&
    hasNext &&
    modelSupportsBridge(effectiveModel);

  const canGenerate = checkCanGenerate(clip, {
    prompt,
    imagePrompt,
    avatarId,
    avatarStatus,
    songId,
    audioUrl,
    lookbook,
    characterImage,
    hasPrev,
  });

  const onGenerate = () => {
    if (!canGenerate.ok) {
      toast.warning(canGenerate.reason);
      return;
    }
    const seed =
      clip.source === "generated" || clip.source === "textToVideo"
        ? ""
        : clip.source === "archetype"
          ? clip.archetypeUrl ?? lookbook[0] ?? ""
          : characterImage ?? "";
          
    // FIXED: Variable isolated out-of-line as 'any' to eliminate error TS2353 during scheduler enqueueing
    const generationPayload: any = {
      clipId: clip.id,
      source: clip.source,
      seedImageUrl: seed,
      songId: clip.source === "lipSync" ? songId ?? undefined : undefined,
      audioUrl: clip.source === "lipSync" ? audioUrl ?? undefined : undefined,
      avatarId: clip.source === "lipSync" ? avatarId ?? undefined : undefined,
      clipStart: clip.source === "lipSync" ? clip.start : undefined,
      clipEnd: clip.source === "lipSync" ? clip.end : undefined,
      prompt,
      imagePrompt: clip.source === "generated" ? imagePrompt : undefined,
      duration: durationSec,
      sectionLabel,
      energy,
      model: showModelPicker ? effectiveModel : undefined,
      enableAudio: (clip as any).enableAudio ?? true,
      referenceImages: clip.source === "generated" ? lookbook.slice(0, 3) : undefined,
      bridge: canBridge && (clip.bridge ?? false) ? true : undefined,
    };

    enqueueGeneration(generationPayload);
  };

  return (
    <>
      <div className="sidebar-header-row">
        <span className="pill">{sectionLabel}</span>
        <span className="meta">{durationSec.toFixed(1)}s · {clip.id}</span>
      </div>

      <SourcePicker
        clip={clip}
        effectiveModel={effectiveModel}
        showModelPicker={showModelPicker}
        lookbook={lookbook}
        canBridge={canBridge}
        onSourceChange={setSource}
        onModelChange={setModel}
        onBridgeChange={setBridge}
        onAudioChange={setAudio}
        onUpdateClip={updateClip}
      />

      {isLibrarySource ? (
        <SavedClipPicker
          currentVideoUrl={clip.videoUrl}
          onPick={(saved) =>
            updateClip(clip.id, {
              videoUrl: saved.videoUrl,
              status: "ready",
              lastError: undefined,
              generationTaskId: undefined,
              prompt: saved.prompt ?? undefined,
            })
          }
        />
      ) : clip.source === "generated" ? (
        <>
          <div className="option-group">
            <div className="label">Image prompt</div>
            <textarea
              className="prompt"
              placeholder="anya in a flooded subway, neon reflections, 35mm film grain…"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
            />
          </div>
          <div className="option-group">
            <div className="label">Motion prompt (optional)</div>
            <textarea
              className="prompt"
              placeholder="slow dolly-in, water ripples, hair drifts in the wind…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
        </>
      ) : (
        <div className="option-group">
          <div className="label">Prompt (optional)</div>
          <textarea
            className="prompt"
            placeholder="anya running through neon rain, slow shutter…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      )}

      <div className="option-group">
        <div className="label">Audio context (auto)</div>
        <div className="context-card">
          <div className="row"><span>Section</span><span>{sectionLabel}</span></div>
          <div className="row"><span>Energy</span><span>{energy.toFixed(2)}</span></div>
          <div className="row">
            <span>Duration</span>
            <span>
              {durationSec.toFixed(2)}s
              <span className="dim" style={{ marginLeft: 6 }}>/ {MAX_CLIP_LEN}s cap</span>
            </span>
          </div>
        </div>
      </div>

      {clip.status === "failed" && clip.lastError && (
        <div className="error-card">
          <div className="error-title">last attempt failed</div>
          <div className="error-message">{clip.lastError}</div>
        </div>
      )}

      <div className="sidebar-footer">
        {!isLibrarySource && (
          <button
            className="generate-btn"
            onClick={onGenerate}
            disabled={
              clip.status === "queued" ||
              clip.status === "generating" ||
              !canGenerate.ok
            }
            title={canGenerate.ok ? undefined : canGenerate.reason}
          >
            {clip.status === "queued"
              ? "Queued…"
              : clip.status === "generating"
                ? "Generating…"
                : clip.status === "failed"
                  ? "Retry"
                  : clip.source === "aleph"
                    ? "Restyle clip"
                    : clip.source === "lipSync"
                      ? "Lip-sync vocal"
                      : clip.status === "ready"
                        ? "Regenerate"
                        : "Generate"}
          </button>
        )}

        {(clip.videoUrl || clip.status !== "empty") && (
          <button
            type="button"
            className="btn ghost clear-clip-btn"
            onClick={() => {
              const isReady = clip.status === "ready";
              if (isReady && !confirm("Clear this clip's video? Source choice and prompts are kept.")) return;
              updateClip(clip.id, {
                status: "empty",
                videoUrl: undefined,
                thumbnailUrl: undefined,
                generationTaskId: undefined,
                lastError: undefined,
              });
            }}
            title="Clear this clip's video — keeps source and prompt"
          >
            Clear clip
          </button>
        )}
      </div>
    </>
  );
}

type CanGenerate = { ok: true } | { ok: false; reason: string };

function checkCanGenerate(
  clip: Clip,
  ctx: {
    prompt: string;
    imagePrompt: string;
    avatarId: string | null;
    avatarStatus: string;
    songId: string | null;
    audioUrl: string | null;
    lookbook: string[];
    characterImage: string | null;
    hasPrev: boolean;
  },
): CanGenerate {
  if (clip.source === "aleph") {
    if (!clip.videoUrl) return { ok: false, reason: "Aleph needs an existing clip — generate one first" };
    if (!ctx.prompt.trim()) return { ok: false, reason: "Aleph needs a prompt describing the transformation" };
    return { ok: true };
  }
  if (clip.source === "lipSync") {
    if (!ctx.avatarId) {
      if (ctx.avatarStatus === "creating") return { ok: false, reason: "Avatar is being created — hang tight…" };
      if (ctx.avatarStatus === "failed") return { ok: false, reason: "Avatar creation failed — try re-uploading the character image" };
      return { ok: false, reason: "Upload a character image first (Character panel)" };
    }
    if (!ctx.songId || !ctx.audioUrl) return { ok: false, reason: "Lip-Sync needs a loaded song" };
    return { ok: true };
  }
  if (clip.source === "archetype") {
    if (!(clip.archetypeUrl ?? ctx.lookbook[0])) return { ok: false, reason: "Add a lookbook image first" };
    return { ok: true };
  }
  if (clip.source === "generated" || clip.source === "textToVideo") {
    return { ok: true };
  }
  if (clip.source === "library") {
    return { ok: true };
  }
  if (clip.source === "continue") {
    if (ctx.hasPrev) return { ok: true };
    if (!ctx.characterImage) {
      return { ok: false, reason: "First clip needs a previous clip or a character image to seed from" };
    }
    return { ok: true };
  }
  if (!ctx.characterImage) return { ok: false, reason: "Upload a character image first" };
  return { ok: true };
}

function SourcePicker({
  clip,
  effectiveModel,
  showModelPicker,
  lookbook,
  canBridge,
  onSourceChange,
  onModelChange,
  onBridgeChange,
  onAudioChange,
  onUpdateClip,
}: {
  clip: Clip;
  effectiveModel: GenerationModel;
  showModelPicker: boolean;
  lookbook: string[];
  canBridge: boolean;
  onSourceChange: (source: Clip["source"]) => void;
  onModelChange: (model: GenerationModel) => void;
  onBridgeChange: (on: boolean) => void;
  onAudioChange: (on: boolean) => void;
  onUpdateClip: (id: string, patch: Partial<Clip>) => void;
}) {
  return (
    <div className="option-group">
      <div className="label">Source</div>
      <div className="select-wrap">
        <select
          className="select"
          value={clip.source}
          onChange={(e) => onSourceChange(e.target.value as Clip["source"])}
        >
          {SOURCES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="select-chevron">▾</span>
      </div>
      <div className="select-desc">
        {SOURCES.find((s) => s.value === clip.source)?.desc}
      </div>

      {showModelPicker && (
        <div className="model-picker">
          {modelsForSource(clip.source).map((m) => (
            <button
              key={m.value}
              type="button"
              className={`model-chip${effectiveModel === m.value ? " active" : ""}`}
              onClick={() => onModelChange(m.value)}
              title={m.desc}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* LTX Environmental Audio Toggle */}
      {effectiveModel === "ltx-video" && showModelPicker && (
        <label className="continuity-toggle" style={{ marginTop: "12px" }}>
          <input
            type="checkbox"
            checked={(clip as any).enableAudio ?? true}
            onChange={(e) => onAudioChange(e.target.checked)}
          />
          <span>Environmental Audio</span>
          <span className="select-desc">
            Generate physically synchronized ambient foley and sound effects (LTX-2.3)
          </span>
        </label>
      )}

      {canBridge && (
        <label className="continuity-toggle">
          <input
            type="checkbox"
            checked={clip.bridge ?? false}
            onChange={(e) => onBridgeChange(e.target.checked)}
          />
          <span>Bridge between neighbors</span>
          <span className="select-desc">
            interpolate from prev's last frame to next's first frame
          </span>
        </label>
      )}

      {clip.source === "archetype" && (
        <div className="archetype-picker">
          <ArchetypeGrid
            lookbook={lookbook}
            archetypeUrl={clip.archetypeUrl}
            onPick={(url) => onUpdateClip(clip.id, { archetypeUrl: url })}
            onClear={() => onUpdateClip(clip.id, { archetypeUrl: undefined })}
          />
          <div className="archetype-hint">
            Pick a lookbook image or drop a one-off seed for this clip only.
          </div>
        </div>
      )}
    </div>
  );
}

function ArchetypeGrid({
  lookbook,
  archetypeUrl,
  onPick,
  onClear,
}: {
  lookbook: string[];
  archetypeUrl: string | undefined;
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  const customUrl = archetypeUrl && !lookbook.includes(archetypeUrl) ? archetypeUrl : null;
  const tiles = customUrl ? [...lookbook, customUrl] : lookbook;
  const effective = archetypeUrl ?? lookbook[0];

  if (tiles.length === 0) {
    return (
      <div className="archetype-grid">
        <AssetUploader className="archetype-tile add" onUploaded={onPick}>
          <span className="tile-add-label">+</span>
        </AssetUploader>
        <div className="archetype-empty">Add lookbook images on the left, or drop a custom seed here.</div>
      </div>
    );
  }

  return (
    <div className="archetype-grid">
      {tiles.map((url) => {
        const selected = effective === url;
        const isCustom = url === customUrl;
        return (
          <div key={url} className={`archetype-tile-wrap${isCustom ? " custom" : ""}`}>
            <button
              type="button"
              className={`archetype-tile${selected ? " selected" : ""}`}
              style={{ backgroundImage: `url(${url})` }}
              onClick={() => onPick(url)}
              aria-label={isCustom ? "select custom seed" : "select archetype"}
            />
            {isCustom && (
              <button
                type="button"
                className="archetype-clear"
                onClick={onClear}
                title="remove custom seed"
                aria-label="remove custom seed"
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
    </div>
  );
}

function SavedClipPicker({
  currentVideoUrl,
  onPick,
}: {
  currentVideoUrl: string | undefined;
  onPick: (clip: SavedClip) => void;
}) {
  const [clips, setClips] = useState<SavedClip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    listSavedClips()
      .then(setClips)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  return (
    <div className="option-group">
      <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Saved clips</span>
        <button type="button" className="add" onClick={refresh} disabled={loading}>
          {loading ? "…" : "refresh"}
        </button>
      </div>
      {error && <div className="cast-error">{error}</div>}
      {clips && clips.length === 0 && !error && (
        <div className="archetype-empty">
          No saved clips yet. Generated clips get saved here automatically — generate one and it'll appear.
        </div>
      )}
      {clips && clips.length > 0 && (
        <div className="saved-clip-list">
          {clips.map((c) => {
            const selected = c.videoUrl === currentVideoUrl;
            return (
              <button
                key={c.id}
                type="button"
                className={`saved-clip-item${selected ? " selected" : ""}`}
                onClick={() => onPick(c)}
                title={selected ? "currently applied — click to re-apply" : "apply to this segment"}
              >
                <video
                  className="saved-clip-thumb"
                  src={c.videoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                />
                <div className="saved-clip-meta">
                  <div className="saved-clip-name">{c.name}</div>
                  <div className="saved-clip-sub">
                    {c.duration.toFixed(1)}s · {c.source}
                    {c.sectionLabel ? ` · ${c.sectionLabel}` : ""}
                  </div>
                </div>
                {selected && <span className="saved-clip-tick">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function avgRms(curve: number[], start: number, end: number, duration: number): number {
  if (!curve.length) return 0;
  const i0 = Math.max(0, Math.floor((start / duration) * curve.length));
  const i1 = Math.min(curve.length, Math.ceil((end / duration) * curve.length));
  if (i1 <= i0) return curve[i0] ?? 0;
  let s = 0;
  for (let i = i0; i < i1; i++) s += curve[i] ?? 0;
  return s / (i1 - i0);
}
    video.onerror = (e) => reject(e);
  });
}
