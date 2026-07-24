export function patchDirectorEditing(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `  const updateTreatment = (key: keyof Treatment, value: string) => {
    setSession((current) => current
      ? { ...current, treatment: { ...current.treatment, [key]: value } }
      : current);
  };`,
    `  const updateTreatment = (key: keyof Treatment, value: string) => {
    setSession((current) => current
      ? { ...current, treatment: { ...current.treatment, [key]: value }, treatmentApproved: false }
      : current);
  };

  const updateShot = (shotId: string, patch: Partial<StoryboardShot>) => {
    setSession((current) => current ? {
      ...current,
      shots: current.shots.map((shot) => shot.id === shotId
        ? { ...shot, ...patch, approved: false }
        : shot),
    } : current);
  };`,
    "editable Director suggestions",
  );

  patched = replaceRequired(
    patched,
    `  const approveStoryboard = () => {
    const incomplete = session.shots.some((shot) => !shot.imageUrl || !shot.approved);
    if (incomplete) {
      toast.warning("Generate and approve every storyboard frame first");
      return;
    }

    for (const shot of session.shots) {
      shot.clipIds.forEach((clipId, index) => {
        updateClip(clipId, {
          prompt: \`\${shot.prompt} Preserve the approved artist identity and storyboard composition.\`,
          archetypeUrl: shot.imageUrl,
          seedImageUrl: shot.imageUrl,
          source: index === 0 ? "imageToVideo" : "continue",
          model: "ltx-video",
          sectionLabel: shot.label,
          status: "empty",
          lastError: undefined,
        });
      });
    }
    updateSession({ stage: "production" });
  };`,
    `  const approveStoryboard = () => {
    const incomplete = session.shots.some((shot) => !shot.prompt.trim() || shot.end <= shot.start || !shot.approved);
    if (incomplete) {
      toast.warning("Accept every edited storyboard direction and make sure each time range is valid");
      return;
    }

    for (const shot of session.shots) {
      const visualAnchor = shot.imageUrl ?? session.characterUrl ?? lookbook[0];
      shot.clipIds.forEach((clipId, index) => {
        updateClip(clipId, {
          prompt: \`\${shot.prompt} Preserve the approved artist identity and storyboard composition.\`,
          archetypeUrl: visualAnchor,
          seedImageUrl: visualAnchor,
          source: visualAnchor
            ? (index === 0 ? "imageToVideo" : "continue")
            : (index === 0 ? "textToVideo" : "continue"),
          model: "ltx-video",
          sectionLabel: shot.label,
          status: "empty",
          lastError: undefined,
        });
      });
    }
    updateSession({ stage: "production" });
  };`,
    "accept edited storyboard without mandatory previews",
  );

  patched = replaceRequired(
    patched,
    `              <ActionRow>
                <button type="button" className="btn" onClick={() => void generateCharacter()} disabled={!!busy}>{session.characterUrl ? "Regenerate character" : "Generate character"}</button>`,
    `              <ActionRow>
                <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "treatment" })} disabled={!!busy}>Back to treatment</button>
                <button type="button" className="btn" onClick={() => void generateCharacter()} disabled={!!busy}>{session.characterUrl ? "Regenerate character" : "Generate character"}</button>`,
    "character back navigation",
  );

  patched = replaceRequired(
    patched,
    `              <ActionRow>
                <button type="button" className="btn" onClick={() => void generateStoryboard()} disabled={!!busy}>
                  {allBoardsGenerated ? "Regenerate missing frames" : "Generate storyboard frames"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!allBoardsGenerated || !!busy}
                  onClick={() => setSession((current) => current ? { ...current, shots: current.shots.map((shot) => ({ ...shot, approved: true })) } : current)}
                >
                  Approve all frames
                </button>
              </ActionRow>`,
    `              <ActionRow>
                <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "character" })} disabled={!!busy}>Back to character</button>
                <button type="button" className="btn" onClick={() => void generateStoryboard()} disabled={!!busy || allBoardsGenerated}>
                  {allBoardsGenerated ? "All previews ready" : "Generate missing previews"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!allDirectionsValid || !!busy}
                  onClick={() => setSession((current) => current ? { ...current, shots: current.shots.map((shot) => ({ ...shot, approved: true })) } : current)}
                >
                  Accept all edited directions
                </button>
              </ActionRow>`,
    "storyboard acceptance controls",
  );

  patched = replaceRequired(
    patched,
    `                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <strong>{shot.label}</strong>
                        <span style={{ fontSize: 11, opacity: 0.55 }}>{shot.start.toFixed(1)}–{shot.end.toFixed(1)}s</span>
                      </div>
                      <textarea
                        value={shot.prompt}
                        onChange={(event) => setSession((current) => current ? {
                          ...current,
                          shots: current.shots.map((item) => item.id === shot.id ? { ...item, prompt: event.target.value, approved: false } : item),
                        } : current)}
                        style={textareaStyle}
                      />
                      <ActionRow>
                        <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void generateStoryboard(shot.id)}>Regenerate frame</button>
                        <button
                          type="button"
                          className={shot.approved ? "btn primary" : "btn"}
                          disabled={!shot.imageUrl}
                          onClick={() => setSession((current) => current ? {
                            ...current,
                            shots: current.shots.map((item) => item.id === shot.id ? { ...item, approved: !item.approved } : item),
                          } : current)}
                        >
                          {shot.approved ? "Approved ✓" : "Approve frame"}
                        </button>
                      </ActionRow>`,
    `                      <div style={shotMetaEditStyle}>
                        <label style={shotFieldStyle}>
                          <span>Section name</span>
                          <input value={shot.label} onChange={(event) => updateShot(shot.id, { label: event.target.value })} style={inputStyle} />
                        </label>
                        <label style={shotFieldStyle}>
                          <span>Start seconds</span>
                          <input type="number" step={0.1} value={shot.start} onChange={(event) => updateShot(shot.id, { start: Number(event.target.value) })} style={inputStyle} />
                        </label>
                        <label style={shotFieldStyle}>
                          <span>End seconds</span>
                          <input type="number" step={0.1} value={shot.end} onChange={(event) => updateShot(shot.id, { end: Number(event.target.value) })} style={inputStyle} />
                        </label>
                      </div>
                      <textarea
                        value={shot.prompt}
                        onChange={(event) => updateShot(shot.id, { prompt: event.target.value })}
                        style={{ ...textareaStyle, minHeight: 150 }}
                        placeholder="Write as much detail as needed. There is no character limit."
                      />
                      <div style={characterCountStyle}>{shot.prompt.length.toLocaleString()} characters · no limit</div>
                      <div style={shotStatusStyle}>
                        {shot.approved
                          ? "Edited direction accepted"
                          : shot.imageUrl
                            ? "Preview ready · accept or keep editing"
                            : "Direction ready · preview is optional"}
                      </div>
                      <ActionRow>
                        <button type="button" className="btn ghost" disabled={!!busy || !shot.prompt.trim()} onClick={() => void generateStoryboard(shot.id)}>{shot.imageUrl ? "Regenerate preview" : "Generate preview"}</button>
                        <button
                          type="button"
                          className={shot.approved ? "btn primary" : "btn"}
                          disabled={!shot.prompt.trim() || shot.end <= shot.start || !!busy}
                          onClick={() => setSession((current) => current ? {
                            ...current,
                            shots: current.shots.map((item) => item.id === shot.id ? { ...item, approved: !item.approved } : item),
                          } : current)}
                        >
                          {shot.approved ? "Accepted ✓" : "Accept edited direction"}
                        </button>
                      </ActionRow>`,
    "fully editable storyboard cards",
  );

  patched = replaceRequired(
    patched,
    `                <button type="button" className="btn primary" disabled={!allBoardsApproved || !!busy} onClick={approveStoryboard}>
                  Approve storyboard and build timeline
                </button>`,
    `                <button type="button" className="btn primary" disabled={!allBoardsApproved || !!busy} onClick={approveStoryboard}>
                  Accept storyboard and build timeline
                </button>`,
    "storyboard final acceptance wording",
  );

  patched = replaceRequired(
    patched,
    `              <ActionRow>
                {!session.productionStarted && <button type="button" className="btn primary" onClick={startProduction}>Approve and start production</button>}`,
    `              <ActionRow>
                {!session.productionStarted && <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "storyboard" })}>Back to storyboard</button>}
                {!session.productionStarted && <button type="button" className="btn primary" onClick={startProduction}>Approve and start production</button>}`,
    "production back navigation",
  );

  patched = replaceRequired(
    patched,
    `              <ActionRow>
                {session.lipSyncEnabled && <button type="button" className="btn primary" onClick={() => void runLipSync()} disabled={!!busy}>Approve and run LipDub</button>}`,
    `              <ActionRow>
                <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "production" })} disabled={!!busy}>Back to production</button>
                {session.lipSyncEnabled && <button type="button" className="btn primary" onClick={() => void runLipSync()} disabled={!!busy}>Approve and run LipDub</button>}`,
    "LipDub back navigation",
  );

  patched = replaceRequired(
    patched,
    `              <ActionRow>
                <button type="button" className="btn primary" onClick={() => void renderFinal()} disabled={!!busy || progress.ready === 0}>`,
    `              <ActionRow>
                <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "lipsync" })} disabled={!!busy}>Back to Lip sync</button>
                <button type="button" className="btn primary" onClick={() => void renderFinal()} disabled={!!busy || progress.ready === 0}>`,
    "final cut back navigation",
  );

  patched = replaceRequired(
    patched,
    `    <label style={{ display: "block", marginTop: 14 }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: 12, opacity: 0.62 }}>{label}</span>
      {multiline
        ? <textarea value={value} onChange={(event) => onChange(event.target.value)} style={textareaStyle} placeholder={placeholder} />
        : <input value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} placeholder={placeholder} />}
    </label>`,
    `    <label style={{ display: "block", marginTop: 14 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: 12, opacity: 0.62 }}>
        <span>{label}</span>
        {multiline && <span>No character limit</span>}
      </span>
      {multiline
        ? <>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} style={textareaStyle} placeholder={placeholder} />
            <span style={characterCountStyle}>{value.length.toLocaleString()} characters · no limit</span>
          </>
        : <input value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} placeholder={placeholder} />}
    </label>`,
    "unlimited Director text fields",
  );

  patched = replaceRequired(
    patched,
    `const errorStyle: CSSProperties = { marginBottom: 16, padding: 13, borderRadius: 10, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.36)", color: "#fecaca", lineHeight: 1.45 };
const busyStyle: CSSProperties = { padding: "10px 20px", background: "rgba(245,158,11,.12)", borderBottom: "1px solid rgba(245,158,11,.25)", color: "#fcd34d", fontSize: 13 };
const directorButtonStyle: CSSProperties = { position: "fixed", right: 18, bottom: 18, zIndex: 250, padding: "11px 16px", borderRadius: 999, border: "1px solid rgba(245,158,11,.55)", background: "#18181b", color: "#fbbf24", fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 35px rgba(0,0,0,.35)" };`,
    `const errorStyle: CSSProperties = { marginBottom: 16, padding: 13, borderRadius: 10, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.36)", color: "#fecaca", lineHeight: 1.45 };
const busyStyle: CSSProperties = { padding: "11px 20px", background: "rgba(245,158,11,.12)", borderBottom: "1px solid rgba(245,158,11,.25)", color: "#fcd34d", fontSize: 13 };
const directorProgressHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 };
const directorProgressTrackStyle: CSSProperties = { height: 8, marginTop: 8, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.1)" };
const directorProgressFillStyle: CSSProperties = { height: "100%", borderRadius: 999, transition: "width .35s ease" };
const directorProgressDetailStyle: CSSProperties = { marginTop: 6, fontSize: 11, color: "#fde68a", opacity: 0.82 };
const shotMetaEditStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) repeat(2, minmax(90px, .7fr))", gap: 8, marginBottom: 10 };
const shotFieldStyle: CSSProperties = { display: "grid", gap: 5, color: "#a1a1aa", fontSize: 10 };
const characterCountStyle: CSSProperties = { display: "block", marginTop: 5, color: "#71717a", fontSize: 10 };
const shotStatusStyle: CSSProperties = { marginTop: 8, padding: "7px 9px", borderRadius: 8, background: "rgba(59,130,246,.09)", border: "1px solid rgba(59,130,246,.18)", color: "#bfdbfe", fontSize: 11 };
const directorButtonStyle: CSSProperties = { position: "fixed", right: 18, bottom: 18, zIndex: 250, padding: "11px 16px", borderRadius: 999, border: "1px solid rgba(245,158,11,.55)", background: "#18181b", color: "#fbbf24", fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 35px rgba(0,0,0,.35)" };`,
    "Director status and editor styles",
  );

  return patched;
}
