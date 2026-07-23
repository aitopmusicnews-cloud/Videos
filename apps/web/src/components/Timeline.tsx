import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useStore, ZOOM_MIN, ZOOM_MAX } from "../lib/store.js";
import { getWs, setWs } from "../lib/wavesurfer-ref.js";
import { Waveform } from "./Waveform.js";
import { toast } from "../lib/toast.js";
import { uploadVideo, saveClipToServer } from "../lib/api.js";

const SECTION_COLORS = [
  "var(--section-intro)",
  "var(--section-verse)",
  "var(--section-chorus)",
  "var(--section-verse)",
  "var(--section-chorus)",
  "var(--section-bridge)",
  "var(--section-chorus)",
];

/** Snap newTime to the nearest beat if it's within ~3px of one. */
function snapToBeat(newTime: number, beats: number[], pxPerSec: number, snapPx = 3): number {
  if (!beats.length || pxPerSec <= 0) return newTime;
  const tol = snapPx / pxPerSec;
  let best = newTime;
  let bestDist = Infinity;
  for (const b of beats) {
    const d = Math.abs(newTime - b);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return bestDist <= tol ? best : newTime;
}

const isVideoFile = (file: File): boolean => {
  if (file.type && file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && ["mp4", "webm", "ogg", "mov", "avi", "mkv", "m4v"].includes(ext);
};

export function Timeline() {
  const analysis = useStore((s) => s.analysis);
  const audioUrl = useStore((s) => s.audioUrl);
  const clips = useStore((s) => s.clips);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const playhead = useStore((s) => s.playhead);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const setPlaying = useStore((s) => s.setPlaying);
  const togglePlay = useStore((s) => s.togglePlay);
  const isPlaying = useStore((s) => s.isPlaying);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const zoomFit = useStore((s) => s.zoomFit);
  const splitAtPlayhead = useStore((s) => s.splitAtPlayhead);
  const mergeWithRight = useStore((s) => s.mergeWithRight);
  const splitPreviewTime = useStore((s) => s.splitPreviewTime);
  const updateClip = useStore((s) => s.updateClip);
  const unloadSong = useStore((s) => s.unloadSong);

  const [audioError, setAudioError] = useState<string | null>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    setAudioError(null);
  }, [audioUrl]);

  const onClipDrop = useCallback(async (clipId: string, file: File) => {
    if (!isVideoFile(file)) {
      toast.warning("Only video files can be dropped here");
      return;
    }
    const clip = useStore.getState().clips.find((c) => c.id === clipId);
    if (!clip) return;
    updateClip(clipId, { status: "generating" });
    try {
      const { url } = await uploadVideo(file);
      updateClip(clipId, { status: "ready", videoUrl: url, source: "upload" });
      toast.success("Video added");

      void saveClipToServer({
        id: clipId,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 60),
        videoUrl: url,
        source: "upload",
        prompt: null,
        duration: clip.end - clip.start,
        sectionLabel: null,
      })
        .then((saved) => {
          if (saved.videoUrl && saved.videoUrl !== url) {
            useStore.getState().updateClip(clipId, { videoUrl: saved.videoUrl });
          }
        })
        .catch((err) => console.warn("auto-save dropped clip failed", err));
    } catch {
      updateClip(clipId, { status: "empty" });
      toast.error("Upload failed");
    }
  }, [updateClip]);

  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Cmd/Ctrl + wheel and trackpad pinch (reported as ctrlKey-true wheel) → zoom.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY / 200);
        useStore.getState().setZoom(useStore.getState().zoom * factor);
        return;
      }
      const dx = e.deltaX;
      const dy = e.deltaY;
      // Vertical-dominant two-finger scroll → zoom (less sensitive than pinch).
      if (Math.abs(dy) > Math.abs(dx) && dy !== 0) {
        e.preventDefault();
        const factor = Math.exp(-dy / 300);
        useStore.getState().setZoom(useStore.getState().zoom * factor);
        return;
      }
      // Horizontal-dominant two-finger scroll → pan the timeline.
      if (dx !== 0) {
        e.preventDefault();
        el.scrollLeft += dx;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const duration = analysis?.duration ?? 1;
  const fitPxPerSec = duration > 0 && containerWidth > 0 ? containerWidth / duration : 0;
  const pxPerSec = fitPxPerSec * zoom;
  const tracksWidth = pxPerSec * duration;

  const playheadPx = useMemo(() => playhead * pxPerSec, [playhead, pxPerSec]);

  // Auto-follow playhead during playback. Jump-scrolls if it falls off-screen,
  // nudges right when it's within 100px of the right edge.
  useEffect(() => {
    if (!isPlaying || !tracksRef.current || tracksWidth <= 0) return;
    const el = tracksRef.current;
    const x = playheadPx;
    const visStart = el.scrollLeft;
    const visEnd = visStart + el.clientWidth;
    const margin = 100;
    if (x < visStart || x > visEnd) {
      el.scrollLeft = x - el.clientWidth / 2;
    } else if (x > visEnd - margin) {
      el.scrollLeft = x - el.clientWidth + margin;
    }
  }, [playheadPx, isPlaying, tracksWidth]);

  // --- Boundary drag state -------------------------------------------------
  const dragRef = useRef<{
    rightClipId: string;
    startMouseX: number;
    startTime: number;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startMouseX;
      const dt = pxPerSec > 0 ? dx / pxPerSec : 0;
      const target = drag.startTime + dt;
      const beats = useStore.getState().analysis?.beats ?? [];
      const snapped = snapToBeat(target, beats, pxPerSec);
      useStore.getState().moveBoundary(drag.rightClipId, snapped);
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.classList.remove("dragging-resize");
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pxPerSec]);

  const onBoundaryDown = (rightClipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const clip = useStore.getState().clips.find((c) => c.id === rightClipId);
    if (!clip) return;
    dragRef.current = {
      rightClipId,
      startMouseX: e.clientX,
      startTime: clip.start,
    };
    document.body.classList.add("dragging-resize");
  };

  if (!analysis || !audioUrl) {
    return (
      <section className="timeline">
        <div className="transport"><div style={{ color: "var(--text-faint)" }}>no song loaded</div></div>
      </section>
    );
  }

  const innerStyle = tracksWidth > 0 ? { width: `${tracksWidth}px` } : undefined;

  return (
    <section className="timeline">
      <div className="transport">
        <button
          type="button"
          className="play"
          onClick={() => { getWs()?.seekTo(0); setPlayhead(0); }}
          aria-label="rewind"
          title="Rewind to start (Home)"
        >
          ⏮
        </button>
        <button
          type="button"
          className="play"
          onClick={togglePlay}
          aria-label={isPlaying ? "pause" : "play"}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <div className="time" aria-label="playback time">
          {formatTime(playhead)} / {formatTime(duration)}
        </div>
        <div className="transport-edit">
          <SplitButton splitPreviewTime={splitPreviewTime} onSplit={() => {
            const r = splitAtPlayhead();
            if (!r.ok) toast.warning(`Can't split: ${(r as any).reason}`);
          }} />
          <button
            type="button"
            className="transport-btn"
            disabled={!selectedClipId}
            onClick={() => {
              if (!selectedClipId) return;
              const r = mergeWithRight(selectedClipId);
              if (!r.ok) toast.warning(`Can't merge: ${(r as any).reason}`);
            }}
            title="Merge selected clip with next (M)"
          >
            Merge
          </button>
        </div>
        <div className="spacer" />
        <div className="zoom-controls">
          <button type="button" className="zoom-btn" onClick={() => setZoom(zoom / 1.5)} title="Zoom out (-)">
            −
          </button>
          <input
            type="range"
            className="zoom-slider"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            aria-label="zoom"
          />
          <button type="button" className="zoom-btn" onClick={() => setZoom(zoom * 1.5)} title="Zoom in (=)">
            +
          </button>
          <button
            type="button"
            className="zoom-btn fit"
            onClick={zoomFit}
            title="Fit (0)"
          >
            {zoom.toFixed(zoom < 10 ? 1 : 0)}×
          </button>
        </div>
      </div>

      <div className="tracks" ref={tracksRef}>
        <div className="tracks-inner" ref={innerRef} style={innerStyle}>
          <div className="row sections">
            {analysis.sections.map((s, i) => {
              const w = ((s.end - s.start) / duration) * 100;
              return (
                <div
                  key={i}
                  className="section-chip"
                  style={{ width: `${w}%`, background: SECTION_COLORS[i % SECTION_COLORS.length] }}
                >
                  {s.label}
                </div>
              );
            })}
          </div>

          <div className="row waveform">
            <Waveform
              audioUrl={audioUrl}
              pxPerSec={pxPerSec}
              onReady={(w) => {
                setWs(w);
                w.setVolume(1);
              }}
              onTime={setPlayhead}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={(err) => setAudioError(err?.message || "Failed to load audio")}
            />
            {audioError && (
              <div className="audio-error-overlay">
                <span className="audio-error-text">
                  Audio file could not be loaded ({audioError === "Failed to fetch" ? "404 Not Found" : audioError}). The file may have expired.
                </span>
                <button type="button" className="btn primary" onClick={unloadSong}>
                  Re-upload Song
                </button>
              </div>
            )}
            <BeatGrid analysis={analysis} />
            <ClipBoundaries clips={clips} duration={duration} />
            {tracksWidth > 0 && (
              <div className="playhead" style={{ left: `${playheadPx}px` }} />
            )}
          </div>

          <div className="row video">
            <div className="clip-track">
              {clips.map((c, i) => {
                const w = ((c.end - c.start) / duration) * 100;
                const cls = [
                  "clip",
                  c.status === "empty"
                    ? "empty"
                    : c.status === "ready"
                      ? "filled"
                      : c.status === "failed"
                        ? "failed"
                        : "queued",
                  selectedClipId === c.id ? "selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={c.id}
                    className="clip-wrap"
                    style={{ width: `${w}%` }}
                  >
                    {i > 0 && (
                      <div
                        className="resize-handle"
                        onMouseDown={(e) => onBoundaryDown(c.id, e)}
                        title="drag to resize"
                      />
                    )}
                    <button
                      type="button"
                      className={`${cls}${dropTarget === c.id ? " drop-over" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectClip(c.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        setDropTarget(c.id);
                      }}
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropTarget(null);
                        const file = e.dataTransfer.files[0];
                        if (file) onClipDrop(c.id, file);
                      }}
                      aria-label={`${c.status} clip ${c.id}`}
                    >
                      {c.status === "ready" && c.videoUrl && (
                        <video
                          className="clip-thumb"
                          src={c.videoUrl}
                          muted
                          preload="metadata"
                        />
                      )}
                      {c.status !== "empty" && (
                        <span
                          className="clip-clear"
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateClip(c.id, { status: "empty", videoUrl: undefined, generationTaskId: undefined, lastError: undefined });
                          }}
                          title="Clear clip"
                        >
                          ×
                        </span>
                      )}
                      <span className="clip-label">
                        <ClipLabel status={c.status} source={c.source} />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClipLabel({ status, source }: { status: string; source: string }) {
  if (status === "ready") return <span>{source}</span>;
  if (status === "empty") return <span>+ click to fill</span>;
  if (status === "failed") return <span>failed · click to retry</span>;
  if (status === "generating") return <span className="dotty">generating</span>;
  if (status === "queued") return <span className="dotty">queued</span>;
  return <span>{status}</span>;
}

function ClipBoundaries({ clips, duration }: { clips: ReturnType<typeof useStore.getState>["clips"]; duration: number }) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      width="100%"
      height="80"
      preserveAspectRatio="none"
    >
      {clips.slice(1).map((c) => {
        const x = (c.start / duration) * 100;
        return (
          <line
            key={c.id}
            x1={`${x}%`}
            x2={`${x}%`}
            y1="0"
            y2="80"
            stroke="rgba(124, 92, 255, 0.5)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        );
      })}
    </svg>
  );
}

function BeatGrid({ analysis }: { analysis: NonNullable<ReturnType<typeof useStore.getState>["analysis"]> }) {
  const duration = analysis.duration;
  const downbeatSet = new Set(analysis.downbeats);
  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      width="100%"
      height="80"
      preserveAspectRatio="none"
    >
      {analysis.beats.map((t, i) => {
        const x = (t / duration) * 100;
        const isDownbeat = downbeatSet.has(t);
        return (
          <line
            key={i}
            x1={`${x}%`}
            x2={`${x}%`}
            y1="0"
            y2="80"
            stroke={isDownbeat ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)"}
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}

function SplitButton({ splitPreviewTime, onSplit }: {
  splitPreviewTime: () => number | null;
  onSplit: () => void;
}) {
  const playhead = useStore((s) => s.playhead);
  void playhead;
  const splitAt = splitPreviewTime();
  return (
    <button
      type="button"
      className="transport-btn"
      onClick={onSplit}
      disabled={splitAt === null}
      title={splitAt !== null ? `Split at ${splitAt.toFixed(2)}s (S)` : "Move playhead inside a clip first"}
    >
      Split{splitAt !== null ? ` @ ${splitAt.toFixed(1)}s` : ""}
    </button>
  );
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
