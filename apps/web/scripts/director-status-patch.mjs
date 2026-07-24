export function patchDirectorStatus(source, replaceRequired) {
  let patched = source;

  const oldDirectorState = `  const [busy, setBusy] = useState<string | null>(null);
  const [productionNote, setProductionNote] = useState<string | null>(null);
  const [directorError, setDirectorError] = useState<string | null>(null);`;

  const directorStateWithActivity = `  const [busy, setBusy] = useState<string | null>(null);
  const [activity, setActivity] = useState<{ label: string; percent: number; startedAt: number } | null>(null);
  const [activityElapsed, setActivityElapsed] = useState(0);
  const [productionNote, setProductionNote] = useState<string | null>(null);
  const [directorError, setDirectorError] = useState<string | null>(null);`;

  patched = replaceRequired(patched, oldDirectorState, directorStateWithActivity, "Director activity state");

  const sessionPersistenceAnchor = `  useEffect(() => {
    if (!session) return;
    localStorage.setItem(storageKey(session.songId), JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (!session || session.stage !== "production" || !session.productionStarted || clips.length === 0) return;`;

  const activityEffect = `  useEffect(() => {
    if (!session) return;
    localStorage.setItem(storageKey(session.songId), JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (!busy) {
      setActivity(null);
      setActivityElapsed(0);
      return;
    }

    setActivity((current) => ({
      label: busy,
      percent: current ? Math.max(5, current.percent) : 5,
      startedAt: current?.startedAt ?? Date.now(),
    }));

    const timer = window.setInterval(() => {
      setActivityElapsed((current) => current + 1);
      setActivity((current) => current ? {
        ...current,
        label: busy,
        percent: Math.min(92, Math.max(current.percent + 1, current.percent + (94 - current.percent) * 0.06)),
      } : current);
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!session || session.stage !== "production" || !session.productionStarted || clips.length === 0) return;`;

  patched = replaceRequired(patched, sessionPersistenceAnchor, activityEffect, "Director elapsed activity timer");

  patched = replaceRequired(
    patched,
    `  const requestImageWithRetry = async (prompt: string, label: string): Promise<string> => {`,
    `  const requestImageWithRetry = async (prompt: string, label: string, progressPercent = 10): Promise<string> => {`,
    "image activity progress signature",
  );

  patched = replaceRequired(
    patched,
    `        setBusy(attempt === 1 ? label : "Image service is waking up. Retrying…");
        const result = await startTextToImage({`,
    `        const activityLabel = attempt === 1 ? label : "Image service is waking up. Retrying…";
        setBusy(activityLabel);
        setActivity((current) => ({
          label: activityLabel,
          percent: Math.max(current?.percent ?? 0, attempt === 1 ? progressPercent : Math.max(progressPercent, 50)),
          startedAt: current?.startedAt ?? Date.now(),
        }));
        const result = await startTextToImage({`,
    "image status progress",
  );

  patched = replaceRequired(
    patched,
    `        const imageUrl = await requestImageWithRetry(
          \`\${characterAnchor} \${shot.prompt}\`,
          \`Generating storyboard \${index + 1} of \${working.shots.length}: \${shot.label}\`,
        );`,
    `        const imageUrl = await requestImageWithRetry(
          \`\${characterAnchor} \${shot.prompt}\`,
          \`Generating storyboard \${index + 1} of \${working.shots.length}: \${shot.label}\`,
          8 + Math.round((index / Math.max(1, working.shots.length)) * 82),
        );`,
    "storyboard generation progress",
  );

  patched = replaceRequired(
    patched,
    `        setBusy(\`Lip-syncing performance shot \${index + 1} of \${performanceClipIds.length}\`);
        updateClip(clip.id, { status: "generating", lastError: undefined });`,
    `        const lipSyncLabel = \`Lip-syncing performance shot \${index + 1} of \${performanceClipIds.length}\`;
        setBusy(lipSyncLabel);
        setActivity((current) => ({
          label: lipSyncLabel,
          percent: 10 + Math.round((index / Math.max(1, performanceClipIds.length)) * 82),
          startedAt: current?.startedAt ?? Date.now(),
        }));
        updateClip(clip.id, { status: "generating", lastError: undefined });`,
    "LipDub status progress",
  );

  patched = replaceRequired(
    patched,
    `      const result = await renderTimeline({
        projectId: finalProjectId,
        audioUrl,
        duration: analysis.duration,
        clips: ready,
        fades: true,
      });`,
    `      setActivity({ label: "Submitting final render…", percent: 15, startedAt: Date.now() });
      const result = await renderTimeline(
        {
          projectId: finalProjectId,
          audioUrl,
          duration: analysis.duration,
          clips: ready,
          fades: true,
        },
        {
          onUpdate: (job) => {
            if (job.state === "queued") {
              const ahead = job.queuePosition ?? 0;
              const label = ahead > 0 ? \`Final render queued (\${ahead} ahead)…\` : "Final render queued…";
              setBusy(label);
              setActivity((current) => ({ label, percent: 30, startedAt: current?.startedAt ?? Date.now() }));
            } else if (job.state === "running") {
              const label = "Rendering final approved music video…";
              setBusy(label);
              setActivity((current) => ({ label, percent: 68, startedAt: current?.startedAt ?? Date.now() }));
            }
          },
        },
      );`,
    "final render status updates",
  );

  patched = replaceRequired(
    patched,
    `  const stageIndex = activeStageIndex(session.stage);
  const allBoardsGenerated = session.shots.length > 0 && session.shots.every((shot) => !!shot.imageUrl);
  const allBoardsApproved = session.shots.length > 0 && session.shots.every((shot) => shot.approved);`,
    `  const stageIndex = activeStageIndex(session.stage);
  const allBoardsGenerated = session.shots.length > 0 && session.shots.every((shot) => !!shot.imageUrl);
  const allDirectionsValid = session.shots.length > 0 && session.shots.every((shot) => shot.prompt.trim() && shot.end > shot.start);
  const allBoardsApproved = allDirectionsValid && session.shots.every((shot) => shot.approved);
  const productionCompleted = progress.ready + progress.failed;
  const productionPercent = clips.length > 0 ? Math.round((productionCompleted / clips.length) * 100) : 0;
  const directorStatus = busy
    ? {
        label: activity?.label ?? busy,
        percent: Math.round(activity?.percent ?? 5),
        detail: \`Working for \${activityElapsed}s. The timer continues while the service or render job is still active.\`,
      }
    : session.stage === "production" && session.productionStarted
      ? {
          label: progress.failed > 0 && progress.active === 0
            ? "Production needs attention"
            : progress.active > 0
              ? "Producing approved clips"
              : productionPercent >= 100
                ? "Production complete"
                : "Waiting for the production queue",
          percent: productionPercent,
          detail: \`\${progress.ready} ready · \${progress.active} active · \${progress.failed} failed · \${clips.length} total\`,
        }
      : null;`,
    "Director global status model",
  );

  patched = replaceRequired(
    patched,
    `        {busy && <div style={busyStyle}>{busy}</div>}`,
    `        {directorStatus && (
          <div style={busyStyle} role="status" aria-live="polite">
            <div style={directorProgressHeaderStyle}>
              <span>{directorStatus.label}</span>
              <strong>{directorStatus.percent}%</strong>
            </div>
            <div style={directorProgressTrackStyle}>
              <div
                style={{
                  ...directorProgressFillStyle,
                  width: directorStatus.percent + "%",
                  background: directorStatus.label.includes("attention") ? "#ef4444" : "#f59e0b",
                }}
              />
            </div>
            <div style={directorProgressDetailStyle}>{directorStatus.detail}</div>
          </div>
        )}`,
    "visible Director status bar",
  );

  return patched;
}
