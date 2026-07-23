import { useStore } from "../lib/store.js";

export function SidebarEmpty() {
  const analysis = useStore((s) => s.analysis);
  const clips = useStore((s) => s.clips);
  const songFilename = useStore((s) => s.songFilename);
  const selectClip = useStore((s) => s.selectClip);
  const lookbook = useStore((s) => s.lookbook);
  const characterImageUrl = useStore((s) => s.characterImageUrl);
  const avatarName = useStore((s) => s.avatarName);

  const readyClips = clips.filter((c) => c.status === "ready").length;
  const queuedClips = clips.filter((c) => c.status === "queued" || c.status === "generating").length;
  const failedClips = clips.filter((c) => c.status === "failed").length;
  const firstEmptyClip = clips.find((c) => c.status === "empty" || c.status === "failed");

  return (
    <>
      <div className="empty-title">Timeline Overview</div>
      <div className="empty-hint">
        {analysis
          ? "Select a clip region on the timeline below to configure or generate."
          : "Drop an audio file on the timeline to start your music video project."}
      </div>

      {analysis && (
        <div className="option-group">
          <div className="label">Project Summary</div>
          <div className="context-card">
            <div className="row">
              <span>Track</span>
              <span className="truncate" style={{ maxWidth: 140 }}>{songFilename || "Loaded"}</span>
            </div>
            <div className="row">
              <span>Timeline Clips</span>
              <span>{clips.length} segments</span>
            </div>
            <div className="row">
              <span>Rendered Status</span>
              <span>
                <span className="badge-green">{readyClips} ready</span>
                {queuedClips > 0 && <span className="badge-yellow" style={{ marginLeft: 4 }}>{queuedClips} active</span>}
                {failedClips > 0 && <span className="badge-red" style={{ marginLeft: 4 }}>{failedClips} failed</span>}
              </span>
            </div>
            <div className="row">
              <span>Cast / Lookbook</span>
              <span>{avatarName || (characterImageUrl ? "Character set" : "No character")} · {lookbook.length} looks</span>
            </div>
          </div>

          {firstEmptyClip && (
            <button
              type="button"
              className="btn primary w-full"
              style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
              onClick={() => selectClip(firstEmptyClip.id)}
            >
              Select Next Empty Clip
            </button>
          )}
        </div>
      )}

      <div className="option-group">
        <div className="label">Keyboard Shortcuts</div>
        <div className="kbd-list">
          <div className="row">
            <span>Play / pause</span>
            <span className="kbd">Space</span>
          </div>
          <div className="row">
            <span>Split at playhead</span>
            <span className="kbd">S</span>
          </div>
          <div className="row">
            <span>Merge with right</span>
            <span className="kbd">M</span>
          </div>
          <div className="row">
            <span>Rewind to start</span>
            <span className="kbd">Home</span>
          </div>
          <div className="row">
            <span>Deselect clip</span>
            <span className="kbd">Esc</span>
          </div>
          <div className="row">
            <span>Zoom timeline</span>
            <span className="kbd">= / - / 0</span>
          </div>
        </div>
      </div>
    </>
  );
}

