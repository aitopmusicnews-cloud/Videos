import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AudioAnalysis } from "@mvs/shared";
import { sliceAudio } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { getWs } from "../lib/wavesurfer-ref.js";
import { toast } from "../lib/toast.js";

const MIN_PROMO_SECONDS = 0.5;
const META_PREFIX = "mvs-promo-project-v1-";

type PromoMeta = {
  sourceSnapshot: Record<string, unknown>;
  sourceSongId: string;
  sourceFilename: string | null;
  sourceStart: number;
  sourceEnd: number;
};

type ProgressState = {
  label: string;
  percent: number;
};

function metaKey(songId: string): string {
  return `${META_PREFIX}${songId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanName(filename: string | null): string {
  return (filename || "Song").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function formatTime(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function shiftTimes(values: number[] | undefined, start: number, end: number): number[] | undefined {
  if (!values) return undefined;
  return values.filter((value) => value >= start && value <= end).map((value) => value - start);
}

function buildPromoAnalysis(analysis: AudioAnalysis, start: number, end: number): AudioAnalysis {
  const duration = end - start;
  const sections = (analysis.sections ?? [])
    .map((section) => {
      const sectionStart = section.start ?? 0;
      const sectionEnd = section.end ?? analysis.duration ?? end;
      const overlapStart = Math.max(start, sectionStart);
      const overlapEnd = Math.min(end, sectionEnd);
      if (overlapEnd <= overlapStart) return null;
      return {
        ...section,
        start: overlapStart - start,
        end: overlapEnd - start,
      };
    })
    .filter((section): section is NonNullable<typeof section> => section !== null);

  if (!sections.length) {
    sections.push({ label: "promo", start: 0, end: duration });
  }

  let rmsCurve = analysis.rmsCurve;
  if (rmsCurve?.length && analysis.duration && analysis.duration > 0) {
    const from = clamp(Math.floor((start / analysis.duration) * rmsCurve.length), 0, rmsCurve.length - 1);
    const to = clamp(Math.ceil((end / analysis.duration) * rmsCurve.length), from + 1, rmsCurve.length);
    rmsCurve = rmsCurve.slice(from, to);
  }

  return {
    ...analysis,
    duration,
    beats: shiftTimes(analysis.beats, start, end),
    bars: shiftTimes(analysis.bars, start, end),
    downbeats: shiftTimes(analysis.downbeats, start, end),
    rmsCurve,
    sections,
  };
}

function readPromoMeta(songId: string | null): PromoMeta | null {
  if (!songId) return null;
  try {
    const raw = localStorage.getItem(metaKey(songId));
    return raw ? JSON.parse(raw) as PromoMeta : null;
  } catch {
    return null;
  }
}

export function PromoRangeSelector() {
  const songId = useStore((state) => state.songId);
  const songFilename = useStore((state) => state.songFilename);
  const audioUrl = useStore((state) => state.audioUrl);
  const analysis = useStore((state) => state.analysis);
  const playhead = useStore((state) => state.playhead);
  const isPlaying = useStore((state) => state.isPlaying);
  const clips = useStore((state) => state.clips);
  const restoreSnapshot = useStore((state) => state.restoreSnapshot);

  const duration = analysis?.duration ?? 0;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [promoMeta, setPromoMeta] = useState<PromoMeta | null>(null);

  useEffect(() => {
    setPromoMeta(readPromoMeta(songId));
    setStart(0);
    setEnd(duration);
    setPreviewing(false);
    setProgress(null);
  }, [songId, duration]);

  useEffect(() => {
    if (!previewing || !analysis) return;
    if (!isPlaying || playhead < end - 0.03) return;
    const ws = getWs();
    ws?.pause();
    ws?.seekTo(duration > 0 ? start / duration : 0);
    useStore.getState().setPlayhead(start);
    setPreviewing(false);
  }, [previewing, playhead, end, start, duration, isPlaying, analysis]);

  const selectedDuration = Math.max(0, end - start);
  const selectionLeft = duration > 0 ? (start / duration) * 100 : 0;
  const selectionWidth = duration > 0 ? (selectedDuration / duration) * 100 : 0;

  const readyCount = useMemo(
    () => clips.filter((clip) => clip.status === "ready" || clip.status === "queued" || clip.status === "generating").length,
    [clips],
  );

  if (!songId || !analysis || !audioUrl || duration <= 0) return null;

  const setRangeStart = (value: number) => {
    setStart(clamp(value, 0, Math.max(0, end - MIN_PROMO_SECONDS)));
  };

  const setRangeEnd = (value: number) => {
    setEnd(clamp(value, Math.min(duration, start + MIN_PROMO_SECONDS), duration));
  };

  const applyPreset = (seconds: number) => {
    const presetStart = clamp(playhead, 0, Math.max(0, duration - MIN_PROMO_SECONDS));
    const presetEnd = clamp(presetStart + seconds, presetStart + MIN_PROMO_SECONDS, duration);
    setStart(presetStart);
    setEnd(presetEnd);
  };

  const previewRange = () => {
    const ws = getWs();
    if (!ws) {
      toast.warning("The waveform is not ready yet");
      return;
    }
    ws.pause();
    ws.seekTo(start / duration);
    useStore.getState().setPlayhead(start);
    setPreviewing(true);
    void ws.play();
  };

  const createPromoProject = async () => {
    if (selectedDuration < MIN_PROMO_SECONDS) {
      toast.warning("Select at least half a second");
      return;
    }
    if (readyCount > 0 && !window.confirm("Create a new promo project from this range? Your current project will be preserved and can be restored from the promo panel.")) {
      return;
    }

    const sourceSnapshot = useStore.getState().getSnapshot();
    const sourceSongId = songId;
    const sourceFilename = songFilename;
    const promoName = `${cleanName(songFilename)} Promo ${formatTime(start)}-${formatTime(end)}`;
    const promoSongId = `${songId}-promo-${Math.round(start * 10)}-${Math.round(end * 10)}-${crypto.randomUUID().slice(0, 5)}`;

    setProgress({ label: "Preparing promo selection", percent: 10 });
    try {
      setProgress({ label: "Trimming the song audio", percent: 35 });
      const sliced = await sliceAudio(audioUrl, start, end);

      setProgress({ label: "Rebuilding beats and song sections", percent: 70 });
      const promoAnalysis = buildPromoAnalysis(analysis, start, end);
      const meta: PromoMeta = {
        sourceSnapshot,
        sourceSongId,
        sourceFilename,
        sourceStart: start,
        sourceEnd: end,
      };
      localStorage.setItem(metaKey(promoSongId), JSON.stringify(meta));

      setProgress({ label: "Opening the new promo project", percent: 90 });
      useStore.setState({ projectId: null, projectName: promoName });
      useStore.getState().loadSong(promoSongId, sliced.url, promoAnalysis, `${promoName}.mp3`);
      setProgress({ label: "Promo project ready", percent: 100 });
      toast.success(`Promo project created: ${formatTime(start)}–${formatTime(end)}`);
      window.setTimeout(() => {
        setProgress(null);
        setOpen(false);
      }, 900);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProgress({ label: `Promo creation failed: ${message}`, percent: 100 });
      toast.error(`Promo creation failed: ${message}`);
    }
  };

  const restoreFullProject = () => {
    if (!promoMeta) return;
    restoreSnapshot(promoMeta.sourceSnapshot);
    localStorage.removeItem(metaKey(songId));
    setPromoMeta(null);
    setOpen(false);
    toast.success("Full song project restored");
  };

  return (
    <>
      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>
        ✂ {promoMeta ? "Promo active" : "Promo Cut"}
      </button>

      {open && (
        <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget && !progress) setOpen(false); }}>
          <section style={panelStyle} aria-label="Select promo song range">
            <header style={headerStyle}>
              <div>
                <div style={eyebrowStyle}>Track selection</div>
                <h2 style={{ margin: "3px 0 0", fontSize: 20 }}>Create a promo cut</h2>
              </div>
              <button type="button" className="btn ghost" disabled={!!progress} onClick={() => setOpen(false)}>Close</button>
            </header>

            <div style={bodyStyle}>
              {promoMeta ? (
                <div style={activeStyle}>
                  <strong>Promo project active</strong>
                  <div style={{ marginTop: 5, opacity: 0.78 }}>
                    Source range {formatTime(promoMeta.sourceStart)}–{formatTime(promoMeta.sourceEnd)} · {formatTime(promoMeta.sourceEnd - promoMeta.sourceStart)} long
                  </div>
                  <button type="button" className="btn" style={{ marginTop: 12 }} onClick={restoreFullProject}>Restore full project</button>
                </div>
              ) : (
                <>
                  <p style={helpStyle}>Choose any part of the song. The app will trim the audio, preserve the detected rhythm and sections inside that range, and open it as a separate project for the Director.</p>

                  <div style={trackStyle}>
                    <div style={{ ...selectionStyle, left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />
                    <div style={{ ...handleStyle, left: `${selectionLeft}%` }} />
                    <div style={{ ...handleStyle, left: `${selectionLeft + selectionWidth}%` }} />
                  </div>

                  <div style={timeGridStyle}>
                    <label style={fieldStyle}>
                      <span>Start</span>
                      <input type="number" min={0} max={Math.max(0, end - MIN_PROMO_SECONDS)} step={0.1} value={start.toFixed(1)} onChange={(event) => setRangeStart(Number(event.target.value))} style={inputStyle} />
                    </label>
                    <label style={fieldStyle}>
                      <span>End</span>
                      <input type="number" min={start + MIN_PROMO_SECONDS} max={duration} step={0.1} value={end.toFixed(1)} onChange={(event) => setRangeEnd(Number(event.target.value))} style={inputStyle} />
                    </label>
                    <div style={durationCardStyle}>
                      <span style={{ opacity: 0.55, fontSize: 11 }}>Selected</span>
                      <strong>{formatTime(selectedDuration)}</strong>
                    </div>
                  </div>

                  <label style={sliderLabelStyle}>
                    Start point
                    <input type="range" min={0} max={Math.max(0, end - MIN_PROMO_SECONDS)} step={0.1} value={start} onChange={(event) => setRangeStart(Number(event.target.value))} style={sliderStyle} />
                  </label>
                  <label style={sliderLabelStyle}>
                    End point
                    <input type="range" min={Math.min(duration, start + MIN_PROMO_SECONDS)} max={duration} step={0.1} value={end} onChange={(event) => setRangeEnd(Number(event.target.value))} style={sliderStyle} />
                  </label>

                  <div style={buttonRowStyle}>
                    <button type="button" className="btn ghost" onClick={() => setRangeStart(playhead)}>Set start at playhead</button>
                    <button type="button" className="btn ghost" onClick={() => setRangeEnd(playhead)}>Set end at playhead</button>
                  </div>
                  <div style={buttonRowStyle}>
                    <button type="button" className="btn ghost" onClick={() => applyPreset(15)}>15 seconds</button>
                    <button type="button" className="btn ghost" onClick={() => applyPreset(30)}>30 seconds</button>
                    <button type="button" className="btn ghost" onClick={() => applyPreset(60)}>60 seconds</button>
                    <button type="button" className="btn" onClick={previewRange}>{previewing ? "Previewing…" : "Preview selection"}</button>
                  </div>
                </>
              )}

              {progress && (
                <div style={progressBoxStyle} role="status" aria-live="polite">
                  <div style={progressHeaderStyle}><span>{progress.label}</span><strong>{progress.percent}%</strong></div>
                  <div style={progressTrackStyle}><div style={{ ...progressFillStyle, width: `${progress.percent}%` }} /></div>
                </div>
              )}

              {!promoMeta && (
                <div style={footerStyle}>
                  <div style={{ opacity: 0.58, fontSize: 12 }}>The original project is stored for one-click restoration.</div>
                  <button type="button" className="btn primary" disabled={!!progress || selectedDuration < MIN_PROMO_SECONDS} onClick={() => void createPromoProject()}>
                    Create promo project
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const launcherStyle: CSSProperties = { position: "fixed", left: 18, bottom: 150, zIndex: 252, padding: "11px 15px", borderRadius: 999, border: "1px solid rgba(244,114,182,.55)", background: "#18181b", color: "#f9a8d4", fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 35px rgba(0,0,0,.35)" };
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 560, display: "grid", placeItems: "center", padding: 18, background: "rgba(0,0,0,.76)", backdropFilter: "blur(8px)" };
const panelStyle: CSSProperties = { width: "min(680px, 96vw)", maxHeight: "92vh", overflow: "hidden", color: "#fafafa", background: "#09090b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 17, boxShadow: "0 30px 100px rgba(0,0,0,.65)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "17px 19px", borderBottom: "1px solid rgba(255,255,255,.09)" };
const eyebrowStyle: CSSProperties = { fontSize: 10, letterSpacing: ".13em", textTransform: "uppercase", opacity: 0.55 };
const bodyStyle: CSSProperties = { padding: 20, overflowY: "auto", maxHeight: "calc(92vh - 76px)" };
const helpStyle: CSSProperties = { margin: 0, opacity: 0.68, lineHeight: 1.5 };
const trackStyle: CSSProperties = { position: "relative", height: 46, marginTop: 20, overflow: "hidden", borderRadius: 10, border: "1px solid rgba(255,255,255,.11)", background: "repeating-linear-gradient(90deg, #18181b 0, #18181b 22px, #202024 23px)" };
const selectionStyle: CSSProperties = { position: "absolute", top: 0, bottom: 0, minWidth: 2, background: "rgba(236,72,153,.38)", borderLeft: "2px solid #f472b6", borderRight: "2px solid #f472b6" };
const handleStyle: CSSProperties = { position: "absolute", top: 0, bottom: 0, width: 3, transform: "translateX(-1px)", background: "#f9a8d4", boxShadow: "0 0 12px rgba(244,114,182,.75)" };
const timeGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 16 };
const fieldStyle: CSSProperties = { display: "grid", gap: 6, color: "#a1a1aa", fontSize: 11 };
const inputStyle: CSSProperties = { width: "100%", padding: "10px 11px", borderRadius: 9, border: "1px solid rgba(255,255,255,.12)", background: "#18181b", color: "#fafafa" };
const durationCardStyle: CSSProperties = { display: "grid", gap: 5, alignContent: "center", padding: "9px 12px", borderRadius: 9, border: "1px solid rgba(244,114,182,.28)", background: "rgba(236,72,153,.09)" };
const sliderLabelStyle: CSSProperties = { display: "grid", gap: 7, marginTop: 14, color: "#a1a1aa", fontSize: 11 };
const sliderStyle: CSSProperties = { width: "100%", accentColor: "#ec4899" };
const buttonRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 };
const activeStyle: CSSProperties = { padding: 16, borderRadius: 12, border: "1px solid rgba(34,197,94,.28)", background: "rgba(34,197,94,.08)", color: "#dcfce7" };
const progressBoxStyle: CSSProperties = { marginTop: 18, padding: 13, borderRadius: 11, border: "1px solid rgba(244,114,182,.27)", background: "rgba(236,72,153,.08)" };
const progressHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 };
const progressTrackStyle: CSSProperties = { height: 8, marginTop: 9, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.09)" };
const progressFillStyle: CSSProperties = { height: "100%", borderRadius: 999, background: "#ec4899", transition: "width .25s ease" };
const footerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.08)" };
