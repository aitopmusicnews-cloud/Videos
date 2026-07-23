import { useStore } from "../lib/store.js";
import { renderTimeline, saveProjectToServer } from "../lib/api.js";
import { getErrorMessage } from "@mvs/shared";
import { useEffect, useRef, useState, useCallback } from "react";
import { QueueStatus } from "./QueueStatus.js";
import { Library } from "./Library.js";
import { toast } from "../lib/toast.js";

export function Header() {
  const songId = useStore((s) => s.songId);
  const songFilename = useStore((s) => s.songFilename);
  const audioUrl = useStore((s) => s.audioUrl);
  const analysis = useStore((s) => s.analysis);
  const clips = useStore((s) => s.clips);
  const resetProject = useStore((s) => s.resetProject);
  const unloadSong = useStore((s) => s.unloadSong);
  const projectId = useStore((s) => s.projectId);
  const projectName = useStore((s) => s.projectName);
  const setProjectName = useStore((s) => s.setProjectName);
  const getSnapshot = useStore((s) => s.getSnapshot);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderLabel, setRenderLabel] = useState<string | null>(null);
  const [fades, setFades] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmConfig, setConfirmConfig] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const onNewProject = () => {
    if (!songId && !analysis && !projectName && !projectId) return;
    setConfirmConfig({
      message: "Discard current project and start over?",
      onConfirm: () => {
        resetProject();
      },
    });
  };

  const onChangeSong = () => {
    if (!songId) return;
    if (clips.some((c) => c.status === "ready" || c.status === "queued" || c.status === "generating")) {
      setConfirmConfig({
        message: "Swap song? Generated clips will be cleared (cast and lookbook stay).",
        onConfirm: () => {
          unloadSong();
        },
      });
    } else {
      unloadSong();
    }
  };

  const doSave = useCallback(async (name: string) => {
    if (!songId || !analysis) return;
    setProjectName(name);
    const id = projectId ?? `proj-${crypto.randomUUID().slice(0, 8)}`;
    if (!projectId) useStore.setState({ projectId: id });

    setSaving(true);
    try {
      await saveProjectToServer(id, name, getSnapshot());
      toast.success("Project saved");
    } catch (err) {
      toast.error(`Save failed: ${getErrorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }, [songId, analysis, projectId, getSnapshot, setProjectName]);

  const onSave = useCallback(() => {
    if (!songId || !analysis) return;
    if (projectName) {
      void doSave(projectName);
    } else {
      setNameDraft(`Project ${new Date().toLocaleDateString()}`);
      setShowNameInput(true);
    }
  }, [songId, analysis, projectName, doSave]);

  const onNameSubmit = useCallback(() => {
    const name = nameDraft.trim();
    if (!name) return;
    setShowNameInput(false);
    void doSave(name);
  }, [nameDraft, doSave]);

  const onExport = async () => {
    if (!songId || !audioUrl || !analysis) return;
    const ready = clips
      .filter((c) => c.status === "ready" && c.videoUrl)
      .map((c) => ({
        start: c.start,
        end: c.end,
        videoUrl: c.videoUrl as string,
        source: c.source,
      }));
    if (!ready.length) {
      toast.warning("No clips ready to render yet");
      return;
    }
    // Use the project's own id as the render filename — using songId here
    // collides whenever two distinct projects are built from the same track.
    // Mint a project id on first export if none exists yet (same pattern as
    // doSave) so the result lives at /storage/renders/<projectId>.mp4.
    let renderId = projectId;
    if (!renderId) {
      renderId = `proj-${crypto.randomUUID().slice(0, 8)}`;
      useStore.setState({ projectId: renderId });
    }
    setRendering(true);
    setRenderLabel("Submitting…");
    try {
      const { url } = await renderTimeline(
        {
          projectId: renderId,
          audioUrl,
          duration: analysis.duration,
          clips: ready,
          fades,
        },
        {
          onUpdate: (job) => {
            if (job.state === "queued") {
              const ahead = (job.queuePosition ?? 0);
              setRenderLabel(ahead > 0 ? `Queued (${ahead} ahead)…` : "Queued…");
            } else if (job.state === "running") {
              setRenderLabel("Rendering…");
            }
          },
        },
      );
      setRenderUrl(url);
      toast.success("Render complete");
    } catch (err) {
      toast.error(`Render failed: ${getErrorMessage(err)}`);
    } finally {
      setRendering(false);
      setRenderLabel(null);
    }
  };

  return (
    <>
      <header className="header">
        <div className="title">
          <span className="dot" />
          <span>{projectName ?? (songId ? `song ${songId.slice(0, 8)}` : "Music Video Studio")}</span>
          {songId && (
            <span className="song-chip" title="loaded song — click × to swap">
              <span className="song-name">{songFilename ?? `song ${songId.slice(0, 8)}`}</span>
              <button
                type="button"
                className="song-chip-close"
                onClick={onChangeSong}
                aria-label="close song and upload a new one"
                title="close & upload a new song"
              >
                ×
              </button>
            </span>
          )}
          {analysis && (
            <span className="dim mono" style={{ marginLeft: 8 }}>
              {analysis.bpm.toFixed(0)} BPM · {analysis.key} · {Math.floor(analysis.duration / 60)}:
              {Math.floor(analysis.duration % 60).toString().padStart(2, "0")}
            </span>
          )}
        </div>
        <div className="actions">
          <QueueStatus />
          <button type="button" className="btn ghost" onClick={() => setShowLibrary(true)}>
            Library
          </button>
          {(songId || analysis || projectName || projectId) && (
            <button type="button" className="btn ghost" onClick={onNewProject} title="Discard and start fresh">
              New
            </button>
          )}
          {analysis && !showNameInput && (
            <button type="button" className="btn" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {showNameInput && (
            <div className="save-name-inline">
              <input
                type="text"
                className="save-name-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onNameSubmit();
                  if (e.key === "Escape") setShowNameInput(false);
                }}
                placeholder="Project name…"
                autoFocus
              />
              <button type="button" className="btn primary" onClick={onNameSubmit} disabled={!nameDraft.trim()}>
                Save
              </button>
              <button type="button" className="btn ghost" onClick={() => setShowNameInput(false)}>
                Cancel
              </button>
            </div>
          )}
          {renderUrl && (
            <a href={renderUrl} target="_blank" className="btn" rel="noreferrer">
              View render
            </a>
          )}
          <div className="export-cluster">
            <button type="button" className="btn primary" onClick={onExport} disabled={!analysis || rendering}>
              {rendering ? (renderLabel ?? "Rendering…") : "Export MP4"}
            </button>
            {analysis && (
              <RenderOptionsMenu fades={fades} setFades={setFades} />
            )}
          </div>
        </div>
      </header>
      {showLibrary && <Library onClose={() => setShowLibrary(false)} />}
      {confirmConfig && (
        <div className="library-overlay" style={{ zIndex: 200 }} onClick={() => setConfirmConfig(null)}>
          <div
            className="library-modal"
            style={{ width: "320px", padding: "var(--sp-4)", gap: "var(--sp-3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "14px", fontWeight: "500", textAlign: "center", color: "var(--text)" }}>
              {confirmConfig.message}
            </div>
            <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "center", marginTop: "4px" }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setConfirmConfig(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RenderOptionsMenu({
  fades,
  setFades,
}: {
  fades: boolean;
  setFades: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="render-options" ref={wrapRef}>
      <button
        type="button"
        className="render-options-btn"
        onClick={() => setOpen((o) => !o)}
        title="Render options"
        aria-label="render options"
        aria-expanded={open}
      >
        ▾
      </button>
      {open && (
        <div className="render-options-popover">
          <label className="render-options-row">
            <input
              type="checkbox"
              checked={fades}
              onChange={(e) => setFades(e.target.checked)}
            />
            <span>
              <span className="render-options-label">Edge fades</span>
              <span className="render-options-hint">
                150ms alpha fade-in/out at each clip's boundary
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
