import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { enqueueGeneration } from "../lib/scheduler.js";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

type ReferenceKind = "character" | "style" | "location" | "shot" | "note";
type ReferenceMedia = "image" | "video" | "note";

type ReferenceItem = {
  id: string;
  kind: ReferenceKind;
  media: ReferenceMedia;
  name: string;
  url?: string;
  anchorUrl?: string;
  note?: string;
  status?: "uploading" | "extracting" | "ready" | "failed";
};

type Treatment = {
  title: string;
  logline: string;
  visualStyle: string;
  colorPalette: string;
  cameraLanguage: string;
  continuityStrategy: string;
};

type CharacterBible = {
  referenceId: string | null;
  referenceSummary: string;
  immutableTraits: string[];
  wardrobe: string;
  prohibitedChanges: string[];
};

type LtxShotPlan = {
  clipId: string;
  sectionLabel: string;
  start: number;
  end: number;
  requiresCharacter: boolean;
  conditioningReferenceId: string | null;
  prompt: string;
  continuityNotes: string;
  transition: string;
};

type LtxDirectorPlan = {
  version: "ltx-director-v1";
  agentModel: string;
  treatment: Treatment;
  characterBible: CharacterBible;
  shots: LtxShotPlan[];
};

type AgentSession = {
  vision: string;
  mustInclude: string;
  avoid: string;
  characterRequired: boolean;
  plan: LtxDirectorPlan | null;
  planAccepted: boolean;
  productionStarted: boolean;
};

type DirectorReferenceDetail = {
  kind?: ReferenceKind;
  media?: ReferenceMedia;
  name?: string;
  url?: string;
  sourceUrl?: string;
  note?: string;
};

const REFERENCE_EVENT = "mvs-director-reference";
const SESSION_VERSION = 1;

function referenceStorageKey(songId: string): string {
  return `mvs-director-reference-chat-v1-${songId}`;
}

function sessionStorageKey(songId: string): string {
  return `mvs-ltx-director-agent-v${SESSION_VERSION}-${songId}`;
}

function emptySession(): AgentSession {
  return {
    vision: "",
    mustInclude: "",
    avoid: "",
    characterRequired: true,
    plan: null,
    planAccepted: false,
    productionStarted: false,
  };
}

function readReferences(songId: string): ReferenceItem[] {
  try {
    const raw = localStorage.getItem(referenceStorageKey(songId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string")
      : [];
  } catch {
    return [];
  }
}

async function requestDirectorPlan(payload: Record<string, unknown>): Promise<LtxDirectorPlan> {
  const response = await fetch("/api/director/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // The API helper is intentionally local so this component can fail cleanly
    // even when a proxy returns HTML during a service restart.
  }
  if (!response.ok) {
    throw new Error(data?.error || (/<html|<!doctype/i.test(text)
      ? "The Render service is temporarily unavailable. Try the Director again."
      : text.slice(0, 500) || `Director request failed (${response.status})`));
  }
  if (!data?.shots || !Array.isArray(data.shots)) {
    throw new Error("The LTX Director Agent returned an incomplete plan.");
  }
  return data as LtxDirectorPlan;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

export function LtxDirectorAgent() {
  const songId = useStore((state) => state.songId);
  const songFilename = useStore((state) => state.songFilename);
  const analysis = useStore((state) => state.analysis);
  const clips = useStore((state) => state.clips);
  const characterImageUrl = useStore((state) => state.characterImageUrl);
  const setCharacter = useStore((state) => state.setCharacter);
  const updateClip = useStore((state) => state.updateClip);

  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<AgentSession>(emptySession);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!songId) {
      setOpen(false);
      setSession(emptySession());
      return;
    }
    try {
      const raw = localStorage.getItem(sessionStorageKey(songId));
      setSession(raw ? { ...emptySession(), ...JSON.parse(raw) } : emptySession());
    } catch {
      setSession(emptySession());
    }
  }, [songId]);

  useEffect(() => {
    if (!songId) return;
    localStorage.setItem(sessionStorageKey(songId), JSON.stringify(session));
  }, [songId, session]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const onReference = (event: Event) => {
      const detail = (event as CustomEvent<DirectorReferenceDetail>).detail;
      if (detail?.kind === "character" && detail.url) setCharacter(detail.url);
      setReferenceRevision((value) => value + 1);
      setOpen(true);
    };
    window.addEventListener(REFERENCE_EVENT, onReference as EventListener);
    return () => window.removeEventListener(REFERENCE_EVENT, onReference as EventListener);
  }, [setCharacter]);

  const references = useMemo(
    () => songId ? readReferences(songId) : [],
    [songId, referenceRevision],
  );

  const readyReferences = useMemo(
    () => references.filter((reference) => reference.media === "note" || (reference.status ?? "ready") === "ready"),
    [references],
  );

  const characterReferences = useMemo(
    () => readyReferences.filter((reference) => reference.kind === "character" && (reference.anchorUrl || reference.url)),
    [readyReferences],
  );

  const referenceOptions = useMemo(() => {
    const options = readyReferences
      .filter((reference) => reference.anchorUrl || (reference.media === "image" && reference.url))
      .map((reference) => ({ id: reference.id, label: `${reference.kind}: ${reference.name}` }));
    if (characterImageUrl && !options.some((option) => option.id === "store-character")) {
      options.unshift({ id: "store-character", label: "character: approved project character" });
    }
    return options;
  }, [readyReferences, characterImageUrl]);

  const clipProgress = useMemo(() => ({
    ready: clips.filter((clip) => clip.status === "ready").length,
    active: clips.filter((clip) => clip.status === "queued" || clip.status === "generating").length,
    failed: clips.filter((clip) => clip.status === "failed").length,
    completed: clips.filter((clip) => clip.status === "ready" || clip.status === "failed").length,
  }), [clips]);

  if (!songId || !analysis || clips.length === 0) return null;

  const updateSession = (patch: Partial<AgentSession>) => {
    setSession((current) => ({ ...current, ...patch }));
  };

  const updateTreatment = (key: keyof Treatment, value: string) => {
    setSession((current) => current.plan ? {
      ...current,
      planAccepted: false,
      plan: { ...current.plan, treatment: { ...current.plan.treatment, [key]: value } },
    } : current);
  };

  const updateCharacterBible = (key: keyof CharacterBible, value: CharacterBible[keyof CharacterBible]) => {
    setSession((current) => current.plan ? {
      ...current,
      planAccepted: false,
      plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } },
    } : current);
  };

  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {
    setSession((current) => current.plan ? {
      ...current,
      planAccepted: false,
      plan: {
        ...current.plan,
        shots: current.plan.shots.map((shot) => shot.clipId === shotId ? { ...shot, ...patch } : shot),
      },
    } : current);
  };

  const resolveReferenceUrl = (referenceId: string | null): string => {
    if (!referenceId) return "";
    if (referenceId === "store-character") return characterImageUrl ?? "";
    const reference = readyReferences.find((item) => item.id === referenceId);
    return reference?.anchorUrl ?? (reference?.media === "image" ? reference.url ?? "" : "");
  };

  const createPlan = async () => {
    if (session.vision.trim().length < 8) {
      setError("Describe the video vision before asking the LTX Director Agent to plan it.");
      return;
    }
    if (session.characterRequired && !characterImageUrl && characterReferences.length === 0) {
      setError("Character conditioning is required. Upload a character image in References and apply it as the character first.");
      setOpen(true);
      return;
    }

    setError(null);
    setBusy("Gemini is studying the song, references, and exact LTX clip boundaries");
    try {
      const plan = await requestDirectorPlan({
        songId,
        songFilename,
        vision: session.vision,
        mustInclude: session.mustInclude,
        avoid: session.avoid,
        characterRequired: session.characterRequired,
        characterImageUrl: characterImageUrl || undefined,
        analysis,
        clips: clips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          end: clip.end,
          sectionLabel: clip.sectionLabel || undefined,
        })),
        references: readyReferences.map((reference) => ({
          id: reference.id,
          kind: reference.kind,
          media: reference.media,
          name: reference.name,
          anchorUrl: reference.anchorUrl ?? (reference.media === "image" ? reference.url : undefined),
          sourceUrl: reference.url,
          note: reference.note,
        })),
      });
      updateSession({ plan, planAccepted: false, productionStarted: false });
      toast.success(`LTX Director plan created with ${plan.agentModel}`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      toast.error(`LTX Director failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const validateAndApplyPlan = (): boolean => {
    const plan = session.plan;
    if (!plan) return false;
    const clipIds = new Set(clips.map((clip) => clip.id));
    const problems: string[] = [];

    for (const shot of plan.shots) {
      if (!clipIds.has(shot.clipId)) problems.push(`Unknown timeline clip ${shot.clipId}`);
      if (!shot.prompt.trim()) problems.push(`${shot.sectionLabel} has no LTX prompt`);
      if (shot.requiresCharacter && !resolveReferenceUrl(shot.conditioningReferenceId)) {
        problems.push(`${shot.sectionLabel} requires a character image but no valid conditioning asset is selected`);
      }
    }
    if (plan.shots.length !== clips.length) problems.push(`The plan has ${plan.shots.length} shots for ${clips.length} timeline clips`);
    if (problems.length) {
      setError(problems.join("; "));
      return false;
    }

    for (const shot of plan.shots) {
      const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId);
      updateClip(shot.clipId, {
        prompt: shot.prompt,
        seedImageUrl: conditioningUrl || undefined,
        archetypeUrl: conditioningUrl || undefined,
        source: conditioningUrl ? "imageToVideo" : "textToVideo",
        model: "ltx-video",
        sectionLabel: shot.sectionLabel,
        status: "empty",
        videoUrl: undefined,
        generationTaskId: undefined,
        lastError: undefined,
      });
    }

    setError(null);
    updateSession({ planAccepted: true, productionStarted: false });
    toast.success("The edited LTX plan is attached to the timeline");
    return true;
  };

  const startProduction = () => {
    const plan = session.plan;
    if (!plan) return;
    if (!session.planAccepted && !validateAndApplyPlan()) return;

    const currentClips = useStore.getState().clips;
    for (const shot of plan.shots) {
      const clip = currentClips.find((item) => item.id === shot.clipId);
      if (!clip) continue;
      const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId);
      if (shot.requiresCharacter && !conditioningUrl) {
        const message = `${shot.sectionLabel} was not queued because character conditioning is missing.`;
        setError(message);
        toast.error(message);
        return;
      }
      (enqueueGeneration as any)({
        clipId: clip.id,
        source: conditioningUrl ? "imageToVideo" : "textToVideo",
        seedImageUrl: conditioningUrl,
        requiresCharacter: shot.requiresCharacter,
        prompt: shot.prompt,
        duration: clip.end - clip.start,
        sectionLabel: shot.sectionLabel,
        energy: 0.65,
        model: "ltx-video",
      });
    }
    updateSession({ productionStarted: true });
    toast.success("LTX production started with strict reference conditioning");
  };

  const retryFailed = () => {
    const plan = session.plan;
    if (!plan) return;
    const failedIds = new Set(useStore.getState().clips.filter((clip) => clip.status === "failed").map((clip) => clip.id));
    for (const shot of plan.shots.filter((item) => failedIds.has(item.clipId))) {
      const clip = useStore.getState().clips.find((item) => item.id === shot.clipId);
      if (!clip) continue;
      const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId);
      if (shot.requiresCharacter && !conditioningUrl) continue;
      (enqueueGeneration as any)({
        clipId: clip.id,
        source: conditioningUrl ? "imageToVideo" : "textToVideo",
        seedImageUrl: conditioningUrl,
        requiresCharacter: shot.requiresCharacter,
        prompt: shot.prompt,
        duration: clip.end - clip.start,
        sectionLabel: shot.sectionLabel,
        energy: 0.65,
        model: "ltx-video",
      });
    }
  };

  const resetAgent = () => {
    localStorage.removeItem(sessionStorageKey(songId));
    setSession(emptySession());
    setError(null);
  };

  const productionPercent = clips.length > 0
    ? Math.round((clipProgress.completed / clips.length) * 100)
    : 0;

  if (!open) {
    return (
      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>
        ✦ LTX Director Agent
        {clipProgress.active > 0 && <span style={activeDotStyle} />}
      </button>
    );
  }

  return (
    <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section style={panelStyle} aria-label="LTX Director Agent">
        <header style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Gemini multimodal planner · LTX-2.3 execution</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>LTX Director Agent</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost" onClick={resetAgent} disabled={!!busy}>Reset</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={!!busy}>Close</button>
          </div>
        </header>

        {busy && (
          <div style={statusBoxStyle} role="status" aria-live="polite">
            <div style={statusHeaderStyle}><span>{busy}</span><strong>{elapsed}s</strong></div>
            <div style={statusTrackStyle}><div style={indeterminateStyle} /></div>
            <div style={statusDetailStyle}>No fallback planner is running. This remains active until Gemini returns a validated clip-by-clip plan.</div>
          </div>
        )}

        {session.productionStarted && !busy && (
          <div style={statusBoxStyle} role="status" aria-live="polite">
            <div style={statusHeaderStyle}>
              <span>{clipProgress.failed > 0 && clipProgress.active === 0 ? "Production needs attention" : clipProgress.active > 0 ? "Producing conditioned LTX clips" : productionPercent === 100 ? "Production complete" : "Production queue"}</span>
              <strong>{productionPercent}%</strong>
            </div>
            <div style={statusTrackStyle}>
              <div style={{ ...statusFillStyle, width: `${productionPercent}%`, background: clipProgress.failed > 0 && clipProgress.active === 0 ? "#ef4444" : "#22c55e" }} />
            </div>
            <div style={statusDetailStyle}>{clipProgress.ready} ready · {clipProgress.active} active · {clipProgress.failed} failed · {clips.length} total</div>
          </div>
        )}

        <div style={bodyStyle}>
          {error && <div style={errorStyle}><strong>Agent needs attention</strong><div style={{ marginTop: 6 }}>{error}</div></div>}

          <div style={assetStripStyle}>
            <div><strong>{characterImageUrl || characterReferences.length ? "Character conditioning ready" : "No character conditioning"}</strong><div style={smallStyle}>{characterReferences.length} uploaded character reference{characterReferences.length === 1 ? "" : "s"} · {readyReferences.length} total inputs</div></div>
            <button type="button" className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>Use ＋ References</button>
          </div>

          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>1. Creative direction</h3>
            <Field label="Vision" value={session.vision} onChange={(vision) => updateSession({ vision, planAccepted: false })} placeholder="Describe the story, performance, world, emotion, locations, wardrobe, and camera behavior." />
            <Field label="Must include" value={session.mustInclude} onChange={(mustInclude) => updateSession({ mustInclude, planAccepted: false })} placeholder="Required actions, locations, props, symbols, wardrobe, or visual moments." />
            <Field label="Avoid" value={session.avoid} onChange={(avoid) => updateSession({ avoid, planAccepted: false })} placeholder="Anything the agent and LTX must not show." />
            <label style={checkStyle}>
              <input type="checkbox" checked={session.characterRequired} onChange={(event) => updateSession({ characterRequired: event.target.checked, planAccepted: false })} />
              <span><strong>Character conditioning required</strong><small style={smallStyle}>When enabled, planning and production fail closed instead of falling back to generic text-to-video.</small></span>
            </label>
            <div style={actionRowStyle}>
              <button type="button" className="btn primary" disabled={!!busy || session.vision.trim().length < 8} onClick={() => void createPlan()}>
                {session.plan ? "Replan with Gemini" : "Build LTX production plan"}
              </button>
            </div>
          </section>

          {session.plan && (
            <>
              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>2. Editable treatment</h3>
                <div style={modelBadgeStyle}>Planned by {session.plan.agentModel}</div>
                <Field label="Title" value={session.plan.treatment.title} onChange={(value) => updateTreatment("title", value)} singleLine />
                <Field label="Logline" value={session.plan.treatment.logline} onChange={(value) => updateTreatment("logline", value)} />
                <Field label="Visual style" value={session.plan.treatment.visualStyle} onChange={(value) => updateTreatment("visualStyle", value)} />
                <Field label="Color palette" value={session.plan.treatment.colorPalette} onChange={(value) => updateTreatment("colorPalette", value)} />
                <Field label="Camera language" value={session.plan.treatment.cameraLanguage} onChange={(value) => updateTreatment("cameraLanguage", value)} />
                <Field label="Continuity strategy" value={session.plan.treatment.continuityStrategy} onChange={(value) => updateTreatment("continuityStrategy", value)} />
              </section>

              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>3. Character bible</h3>
                <label style={fieldStyle}>
                  <span>Primary conditioning asset</span>
                  <select value={session.plan.characterBible.referenceId ?? ""} onChange={(event) => updateCharacterBible("referenceId", event.target.value || null)} style={inputStyle}>
                    <option value="">No asset selected</option>
                    {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <Field label="Reference summary" value={session.plan.characterBible.referenceSummary} onChange={(value) => updateCharacterBible("referenceSummary", value)} />
                <Field label="Immutable traits" value={session.plan.characterBible.immutableTraits.join("\n")} onChange={(value) => updateCharacterBible("immutableTraits", value.split("\n").filter(Boolean))} />
                <Field label="Wardrobe lock" value={session.plan.characterBible.wardrobe} onChange={(value) => updateCharacterBible("wardrobe", value)} />
                <Field label="Prohibited changes" value={session.plan.characterBible.prohibitedChanges.join("\n")} onChange={(value) => updateCharacterBible("prohibitedChanges", value.split("\n").filter(Boolean))} />
              </section>

              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>4. Clip-by-clip LTX instructions</h3>
                <p style={helpStyle}>Every field is editable. Prompts have no UI character limit; LTX performs best when the final prompt stays below 200 words.</p>
                <div style={shotGridStyle}>
                  {session.plan.shots.map((shot) => {
                    const promptWords = words(shot.prompt);
                    const conditioningReady = !shot.requiresCharacter || Boolean(resolveReferenceUrl(shot.conditioningReferenceId));
                    return (
                      <article key={shot.clipId} style={{ ...shotCardStyle, borderColor: conditioningReady ? "rgba(255,255,255,.13)" : "rgba(239,68,68,.65)" }}>
                        <div style={shotHeaderStyle}>
                          <strong>{shot.sectionLabel}</strong>
                          <span style={smallStyle}>{formatTime(shot.start)}–{formatTime(shot.end)} · {shot.clipId}</span>
                        </div>
                        <Field label="Section label" value={shot.sectionLabel} onChange={(value) => updateShot(shot.clipId, { sectionLabel: value })} singleLine />
                        <label style={checkStyle}>
                          <input type="checkbox" checked={shot.requiresCharacter} onChange={(event) => updateShot(shot.clipId, {
                            requiresCharacter: event.target.checked,
                            conditioningReferenceId: event.target.checked
                              ? shot.conditioningReferenceId ?? session.plan?.characterBible.referenceId ?? null
                              : shot.conditioningReferenceId,
                          })} />
                          <span>Principal character appears in this clip</span>
                        </label>
                        <label style={fieldStyle}>
                          <span>Conditioning asset</span>
                          <select value={shot.conditioningReferenceId ?? ""} onChange={(event) => updateShot(shot.clipId, { conditioningReferenceId: event.target.value || null })} style={inputStyle}>
                            <option value="">Text-only shot</option>
                            {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        {!conditioningReady && <div style={blockingStyle}>Blocked: this character shot has no usable image condition.</div>}
                        <Field label="LTX-2.3 prompt" value={shot.prompt} onChange={(value) => updateShot(shot.clipId, { prompt: value })} tall />
                        <div style={{ ...countStyle, color: promptWords > 200 ? "#fca5a5" : "#a1a1aa" }}>{shot.prompt.length.toLocaleString()} characters · {promptWords} words · no UI limit</div>
                        <Field label="Continuity notes" value={shot.continuityNotes} onChange={(value) => updateShot(shot.clipId, { continuityNotes: value })} />
                        <Field label="Transition" value={shot.transition} onChange={(value) => updateShot(shot.clipId, { transition: value })} />
                      </article>
                    );
                  })}
                </div>
                <div style={actionRowStyle}>
                  <button type="button" className="btn primary" disabled={!!busy} onClick={validateAndApplyPlan}>
                    {session.planAccepted ? "Plan attached ✓" : "Accept edited plan and build timeline"}
                  </button>
                  <button type="button" className="btn" disabled={!!busy} onClick={startProduction}>Start conditioned LTX production</button>
                  {clipProgress.failed > 0 && <button type="button" className="btn" onClick={retryFailed}>Retry failed clips</button>}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  singleLine = false,
  tall = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  singleLine?: boolean;
  tall?: boolean;
}) {
  return (
    <label style={fieldStyle}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span>{label}</span>{!singleLine && <span>No character limit</span>}</span>
      {singleLine
        ? <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={inputStyle} />
        : <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={{ ...textareaStyle, minHeight: tall ? 180 : 92 }} />}
    </label>
  );
}

const launcherStyle: CSSProperties = { position: "fixed", right: 18, bottom: 18, zIndex: 250, padding: "11px 16px", borderRadius: 999, border: "1px solid rgba(34,197,94,.6)", background: "#111827", color: "#86efac", fontWeight: 750, cursor: "pointer", boxShadow: "0 10px 35px rgba(0,0,0,.4)" };
const activeDotStyle: CSSProperties = { display: "inline-block", width: 8, height: 8, marginLeft: 8, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 10px #22c55e" };
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 570, display: "grid", placeItems: "center", padding: 18, background: "rgba(0,0,0,.8)", backdropFilter: "blur(8px)" };
const panelStyle: CSSProperties = { width: "min(1180px, 97vw)", maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fafafa", background: "#09090b", border: "1px solid rgba(134,239,172,.26)", borderRadius: 17, boxShadow: "0 35px 110px rgba(0,0,0,.7)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,.09)" };
const eyebrowStyle: CSSProperties = { fontSize: 10, letterSpacing: ".13em", textTransform: "uppercase", opacity: .55 };
const bodyStyle: CSSProperties = { padding: 20, overflowY: "auto" };
const statusBoxStyle: CSSProperties = { padding: "12px 20px", background: "rgba(34,197,94,.08)", borderBottom: "1px solid rgba(34,197,94,.22)" };
const statusHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, color: "#bbf7d0", fontSize: 13 };
const statusTrackStyle: CSSProperties = { height: 8, marginTop: 9, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.09)" };
const statusFillStyle: CSSProperties = { height: "100%", borderRadius: 999, transition: "width .25s ease" };
const indeterminateStyle: CSSProperties = { width: "45%", height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#22c55e,#86efac,#22c55e)", animation: "director-agent-pulse 1.4s ease-in-out infinite alternate" };
const statusDetailStyle: CSSProperties = { marginTop: 7, color: "#86efac", opacity: .72, fontSize: 11 };
const errorStyle: CSSProperties = { marginBottom: 18, padding: 14, borderRadius: 11, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.42)", color: "#fecaca", lineHeight: 1.45 };
const assetStripStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: 14, borderRadius: 12, background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.22)" };
const sectionStyle: CSSProperties = { marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,.08)" };
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 18 };
const helpStyle: CSSProperties = { margin: "7px 0 0", opacity: .62, lineHeight: 1.5 };
const fieldStyle: CSSProperties = { display: "grid", gap: 7, marginTop: 14, color: "#a1a1aa", fontSize: 11 };
const inputStyle: CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,.13)", background: "#18181b", color: "#fafafa" };
const textareaStyle: CSSProperties = { ...inputStyle, resize: "vertical", lineHeight: 1.5 };
const checkStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 15, color: "#e4e4e7", fontSize: 13 };
const smallStyle: CSSProperties = { display: "block", marginTop: 3, fontSize: 11, opacity: .6, fontWeight: 400 };
const actionRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 };
const modelBadgeStyle: CSSProperties = { display: "inline-block", marginTop: 10, padding: "5px 9px", borderRadius: 999, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.25)", color: "#86efac", fontSize: 11 };
const shotGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 15, marginTop: 17 };
const shotCardStyle: CSSProperties = { padding: 14, border: "1px solid rgba(255,255,255,.13)", borderRadius: 13, background: "rgba(255,255,255,.025)" };
const shotHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" };
const blockingStyle: CSSProperties = { marginTop: 10, padding: 9, borderRadius: 8, background: "rgba(239,68,68,.12)", color: "#fca5a5", fontSize: 12 };
const countStyle: CSSProperties = { marginTop: 6, textAlign: "right", fontSize: 10 };
