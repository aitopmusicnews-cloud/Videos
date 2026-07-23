import { useStore } from "../lib/store.js";

export function SidebarEmpty() {
  const analysis = useStore((s) => s.analysis);
  const clips = useStore((s) => s.clips);
  const songFilename = useStore((s) => s.songFilename);
  const selectClip = useStore((s) => s.selectClip);
  const lookbook = useStore((s) => s.lookbook);

  const readyClips = clips.filter((clip) => clip.status === "ready").length;
  const activeClips = clips.filter((clip) => clip.status === "queued" || clip.status === "generating").length;
  const failedClips = clips.filter((clip) => clip.status === "failed").length;
  const firstEmptyClip = clips.find((clip) => clip.status === "empty" || clip.status === "failed");

  return (
    <>
      <div className="empty-title">LTX-2.3 Timeline</div>
      <div className="empty-hint">
        {analysis
          ? "Select a timeline clip to generate with LTX-2.3."
          : "Drop a song on the timeline to create generation segments."}
      </div>

      {analysis && (
        <div className="option-group">
          <div className="label">Project summary</div>
          <div className="context-card">
            <div className="row"><span>Track</span><span className="truncate">{songFilename || "Loaded"}</span></div>
            <div className="row"><span>Timeline clips</span><span>{clips.length}</span></div>
            <div className="row">
              <span>Status</span>
              <span>
                <span className="badge-green">{readyClips} ready</span>
                {activeClips > 0 && <span className="badge-yellow"> · {activeClips} active</span>}
                {failedClips > 0 && <span className="badge-red"> · {failedClips} failed</span>}
              </span>
            </div>
            <div className="row"><span>Reference images</span><span>{lookbook.length}</span></div>
          </div>

          {firstEmptyClip && (
            <button
              type="button"
              className="btn primary w-full"
              style={{ marginTop: 10 }}
              onClick={() => selectClip(firstEmptyClip.id)}
            >
              Open next clip
            </button>
          )}
        </div>
      )}

      <div className="option-group">
        <div className="label">Available generation</div>
        <div className="context-card">
          <div className="row"><span>Text → Video</span><span>Ready</span></div>
          <div className="row"><span>Image → Video</span><span>Ready</span></div>
          <div className="row"><span>Continue clip</span><span>Ready</span></div>
          <div className="row"><span>Native audio</span><span>Always on</span></div>
        </div>
      </div>

      <div className="option-group">
        <div className="label">Keyboard shortcuts</div>
        <div className="kbd-list">
          <div className="row"><span>Play / pause</span><span className="kbd">Space</span></div>
          <div className="row"><span>Split at playhead</span><span className="kbd">S</span></div>
          <div className="row"><span>Merge with right</span><span className="kbd">M</span></div>
          <div className="row"><span>Deselect clip</span><span className="kbd">Esc</span></div>
          <div className="row"><span>Zoom timeline</span><span className="kbd">= / - / 0</span></div>
        </div>
      </div>
    </>
  );
}
