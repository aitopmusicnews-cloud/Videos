import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../lib/store.js";
import type { Clip } from "@mvs/shared";
import { useJobPolling } from "../../hooks/useJobPolling";
import { listSavedClips } from "../lib/api.js";

type StoreState = ReturnType<typeof useStore.getState>;

/**
 * Double-buffered video preview. Two <video> elements alternate so the next
 * clip can preload while the current one plays — no black flash at boundaries.
 */
export function VideoPreview() {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [frontSlot, setFrontSlot] = useState<"a" | "b">("a");
  const loadedRef = useRef<{ a: string | null; b: string | null }>({ a: null, b: null });
  const recoveredOnMountRef = useRef(false);
  const repairRequestsRef = useRef(new Set<string>());

  const clips = useStore((s: StoreState) => s.clips);
  const playhead = useStore((s: StoreState) => s.playhead);
  const isPlaying = useStore((s: StoreState) => s.isPlaying);
  const selectedClipId = useStore((s: StoreState) => s.selectedClipId);
  const updateClip = useStore((s: StoreState) => s.updateClip);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const playheadClip = clips.find((c) => playhead >= c.start && playhead < c.end) ?? null;
  const targetClip = playheadClip?.generationTaskId ? playheadClip : selectedClip;
  const activeJobId = targetClip?.generationTaskId;

  const { status: pollStatus } = useJobPolling({
    jobId: activeJobId,
    intervalMs: 3000,
    onSuccess: (completedUrl: string) => {
      if (targetClip) {
        updateClip(targetClip.id, {
          videoUrl: completedUrl,
          status: "ready",
          generationTaskId: undefined,
          lastError: undefined,
        });
      }
    },
    onFailure: (errMsg: string) => {
      if (targetClip) {
        updateClip(targetClip.id, {
          status: "failed",
          lastError: errMsg,
          generationTaskId: undefined,
        });
      }
    },
  });

  useEffect(() => {
    if (targetClip && pollStatus === "pending" && targetClip.status !== "generating") {
      updateClip(targetClip.id, { status: "generating" });
    }
  }, [pollStatus, targetClip, updateClip]);

  // Repair URLs already persisted in this browser. The clips API refreshes
  // private-S3 links on every read, so old unsigned or expired links become
  // playable without forcing the user to regenerate the clip.
  useEffect(() => {
    if (recoveredOnMountRef.current) return;
    recoveredOnMountRef.current = true;
    let cancelled = false;

    void listSavedClips()
      .then((savedClips) => {
        if (cancelled) return;
        const savedById = new Map(savedClips.map((saved) => [saved.id, saved]));
        for (const localClip of useStore.getState().clips) {
          if (localClip.status !== "ready" || !localClip.videoUrl) continue;
          const saved = savedById.get(localClip.id);
          if (saved?.videoUrl && saved.videoUrl !== localClip.videoUrl) {
            updateClip(localClip.id, { videoUrl: saved.videoUrl });
          }
        }
      })
      .catch(() => {
        // Preview can still use temporary Modal URLs when the library is offline.
      });

    return () => {
      cancelled = true;
    };
  }, [updateClip]);

  const readyClips = clips.filter((c): c is Clip & { videoUrl: string } =>
    c.status === "ready" && !!c.videoUrl
  );
  const active = readyClips.find((c) => playhead >= c.start && playhead < c.end) ?? null;
  const activeIdx = active ? readyClips.indexOf(active) : -1;
  const next = activeIdx >= 0 ? readyClips[activeIdx + 1] ?? null : null;

  const slotEl = useCallback((slot: "a" | "b") => slot === "a" ? aRef.current : bRef.current, []);
  const slotKey = (clip: { id: string; videoUrl: string }) => `${clip.id}\0${clip.videoUrl}`;

  const repairClipUrl = useCallback(async (clip: Clip & { videoUrl: string }) => {
    const requestKey = `${clip.id}\0${clip.videoUrl}`;
    if (repairRequestsRef.current.has(requestKey)) return;
    repairRequestsRef.current.add(requestKey);
    try {
      const savedClips = await listSavedClips();
      const saved = savedClips.find((item) => item.id === clip.id);
      if (saved?.videoUrl && saved.videoUrl !== clip.videoUrl) {
        updateClip(clip.id, { videoUrl: saved.videoUrl, lastError: undefined });
      }
    } catch {
      // Leave the existing URL in place; a later reload can retry the refresh.
    }
  }, [updateClip]);

  const loadInto = useCallback((slot: "a" | "b", clip: { id: string; videoUrl: string }) => {
    const key = slotKey(clip);
    if (loadedRef.current[slot] === key) return;
    const el = slotEl(slot);
    if (!el) return;
    loadedRef.current[slot] = key;
    let safeUrl = clip.videoUrl;
    if (typeof window !== "undefined" && window.location.protocol === "https:") {
      safeUrl = safeUrl.replace(/^http:\/\//, "https://");
    }
    el.src = safeUrl;
    el.load();
  }, [slotEl]);

  useEffect(() => {
    if (!active) return;
    const back: "a" | "b" = frontSlot === "a" ? "b" : "a";
    const cleanups: Array<() => void> = [];
    const activeKey = slotKey(active);
    const slotDur = active.end - active.start;

    if (loadedRef.current[frontSlot] === activeKey) {
      const front = slotEl(frontSlot);
      if (front) {
        applyPlaybackRate(front, slotDur, active.source);
        seekTo(front, active, playhead);
        repaintIfStale(front, isPlaying);
      }
    } else if (loadedRef.current[back] === activeKey) {
      const oldFront = slotEl(frontSlot);
      const newFront = slotEl(back);
      oldFront?.pause();
      if (newFront) {
        applyPlaybackRate(newFront, slotDur, active.source);
        seekTo(newFront, active, playhead);
        repaintIfStale(newFront, isPlaying);
      }
      setFrontSlot(back);
    } else {
      loadInto(frontSlot, active);
      const front = slotEl(frontSlot);
      if (front) {
        const onMeta = () => applyPlaybackRate(front, slotDur, active.source);
        if (front.readyState >= 1) onMeta();
        else {
          front.addEventListener("loadedmetadata", onMeta);
          cleanups.push(() => front.removeEventListener("loadedmetadata", onMeta));
        }
      }
    }

    if (next && loadedRef.current[back] !== slotKey(next)) {
      loadInto(back, next);
    }
    return () => { for (const cleanup of cleanups) cleanup(); };
  }, [active, next, frontSlot, slotEl, loadInto, isPlaying, playhead]);

  useEffect(() => {
    if (!active) return;
    const front = slotEl(frontSlot);
    if (!front) return;
    const doSeek = () => {
      seekTo(front, active, playhead);
      if (!isPlaying) repaintIfStale(front, false);
    };
    if (front.readyState >= 1) {
      doSeek();
      return;
    }
    front.addEventListener("loadedmetadata", doSeek);
    return () => front.removeEventListener("loadedmetadata", doSeek);
  }, [playhead, active, frontSlot, slotEl, isPlaying]);

  useEffect(() => {
    const front = slotEl(frontSlot);
    if (!front || !active) return;
    if (isPlaying) {
      if (front.ended) front.currentTime = 0;
      front.play().catch(() => {});
    } else {
      front.pause();
    }
  }, [isPlaying, active, frontSlot, slotEl]);

  const containerRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const slotStyle = (slot: "a" | "b"): React.CSSProperties => ({
    width: "100%",
    height: "100%",
    position: "absolute",
    inset: 0,
    opacity: active && frontSlot === slot ? 1 : 0,
    pointerEvents: active && frontSlot === slot ? "auto" : "none",
  });

  return (
    <div ref={containerRef} className="preview-container" style={{ position: "relative" }}>
      <video
        ref={aRef}
        muted
        playsInline
        preload="auto"
        style={slotStyle("a")}
        onError={() => { if (active) void repairClipUrl(active); }}
      />
      <video
        ref={bRef}
        muted
        playsInline
        preload="auto"
        style={slotStyle("b")}
        onError={() => { if (active) void repairClipUrl(active); }}
      />

      {playheadClip && (playheadClip.status === "generating" || playheadClip.status === "queued") && (
        <div className="preview-empty preview-empty-overlay" style={{ background: "rgba(9, 10, 15, 0.85)", backdropFilter: "blur(4px)", zIndex: 5 }}>
          <div className="h-8 w-8 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-3" />
          <div className="label-big" style={{ fontSize: "1.1rem", textTransform: "none", color: "#f4f4f5" }}>
            {playheadClip.status === "queued" ? "Queued in workspace..." : "Generating Video & Foley..."}
          </div>
          <div style={{ marginTop: "4px", color: "#a1a1aa", fontSize: "0.8rem" }}>
            LTX-2.3-Audio pipeline running on Modal GPU...
          </div>
        </div>
      )}

      {playheadClip && playheadClip.status === "failed" && !active && (
        <div className="preview-empty preview-empty-overlay" style={{ background: "rgba(9, 10, 15, 0.9)", zIndex: 5 }}>
          <div className="label-big" style={{ color: "#f87171", fontSize: "1.2rem" }}>Generation Failed</div>
          <div style={{ marginTop: "6px", color: "#d4d4d8", maxWidth: "80%", textAlign: "center", fontSize: "0.85rem" }}>
            {playheadClip.lastError || "Unknown GPU cluster error."}
          </div>
        </div>
      )}

      {!active && (!playheadClip || (playheadClip.status !== "generating" && playheadClip.status !== "queued" && playheadClip.status !== "failed")) && (
        <div className="preview-empty preview-empty-overlay">
          <div className="label-big">preview</div>
          <div>no clip at playhead</div>
        </div>
      )}

      <button
        type="button"
        className="preview-fullscreen"
        onClick={toggleFullscreen}
        title="Toggle fullscreen"
        aria-label="toggle fullscreen"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    </div>
  );
}

function seekTo(el: HTMLVideoElement, clip: { start: number; end: number }, playhead: number) {
  const clipDur = clip.end - clip.start;
  const vidDur = el.duration;
  if (!vidDur || !clipDur) return;
  const frac = Math.max(0, Math.min(1, (playhead - clip.start) / clipDur));
  const target = Math.min(frac * vidDur, vidDur - 0.01);
  if (Math.abs(el.currentTime - target) > 0.15) {
    el.currentTime = target;
  }
}

function repaintIfStale(el: HTMLVideoElement, isPlaying: boolean): void {
  if (isPlaying) {
    el.play().catch(() => {});
    return;
  }
  if (el.ended || el.readyState < 2) {
    el.play().then(() => el.pause()).catch(() => {});
  }
}

function applyPlaybackRate(el: HTMLVideoElement, slotDur: number, source?: string): void {
  if (source === "lipSync") {
    if (el.playbackRate !== 1) el.playbackRate = 1;
    return;
  }
  const vidDur = el.duration;
  if (!Number.isFinite(vidDur) || vidDur <= 0 || slotDur <= 0) return;
  const rate = Math.max(0.25, Math.min(4, vidDur / slotDur));
  if (Math.abs(el.playbackRate - rate) > 0.01) {
    el.playbackRate = rate;
  }
}
