import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { AudioAnalysis, Clip, Task } from "@mvs/shared";
import { useStore } from "../lib/store.js";
import {
  pollTask,
  renderTimeline,
  saveClipToServer,
  saveImageToLibrary,
  saveProjectToServer,
  startLipSync,
  startTextToImage,
} from "../lib/api.js";
import { enqueueGeneration } from "../lib/scheduler.js";
import { toast } from "../lib/toast.js";

const DIRECTOR_VERSION = 2;
const MAX_STORYBOARD_FRAMES = 12;
const MAX_LIPSYNC_SHOTS = 4;

type DirectorStage = "vision" | "treatment" | "character" | "storyboard" | "production" | "lipsync" | "final";

type Treatment = {
  title: string;
  logline: string;
  visualStyle: string;
  colorPalette: string;
  cameraLanguage: string;
};

type StoryboardShot = {
  id: string;
  label: string;
  start: number;
  end: number;
  prompt: string;
  clipIds: string[];
  imageUrl?: string;
  approved: boolean;
};

type DirectorSession = {
  version: number;
  songId: string;
  stage: DirectorStage;
  vision: string;
  mustInclude: string;
  avoid: string;
  treatmentVariation: number;
  treatment: Treatment;
  treatmentApproved: boolean;
  characterPrompt: string;
  characterUrl?: string;
  characterApproved: boolean;
  shots: StoryboardShot[];
  productionStarted: boolean;
  lipSyncEnabled: boolean;
  lipSyncStarted: boolean;
  lipSyncedClipIds: string[];
  renderUrl?: string;
};

const STAGES: Array<{ id: DirectorStage; label: string }> = [
  { id: "vision", label: "Your vision" },
  { id: "treatment", label: "Treatment" },
  { id: "character", label: "Character" },
  { id: "storyboard", label: "Storyboard" },
  { id: "production", label: "Production" },
  { id: "lipsync", label: "Lip sync" },
  { id: "final", label: "Final cut" },
];

const VISION_STARTERS = [
  "Performance-driven",
  "Narrative story",
  "Surreal dream",
  "Luxury editorial",
  "Raw street energy",
  "Retro film",
];

function storageKey(songId: string): string {
  return `mvs-auto-director-v${DIRECTOR_VERSION}-${songId}`;
}

function cleanTitle(filename: string | null): string {
  return (filename || "Untitled song").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function sectionEnergy(label: string, bpm: number): string {
  const normalized = label.toLowerCase();
  if (/chorus|hook|drop/.test(normalized)) return "a high-impact hero moment with the strongest visual scale and performance energy";
  if (/bridge|break/.test(normalized)) return "an unexpected emotional or surreal transition that changes the visual language";
  if (/intro/.test(normalized)) return "an atmospheric opening that establishes the world, character, and central visual idea";
  if (/outro/.test(normalized)) return "a memorable closing image that resolves the concept and leaves a final emotional impression";
  return bpm >= 115
    ? "a rhythmic sequence with kinetic movement and editorial momentum"
    : "an intimate sequence with deliberate movement and emotional detail";
}

function sectionArc(label: string, index: number, total: number): string {
  const normalized = label.toLowerCase();
  if (/intro/.test(normalized) || index === 0) return "Introduce the visual world and reveal the artist with restraint.";
  if (/chorus|hook|drop/.test(normalized)) return "Deliver the boldest, most repeatable signature image of the video.";
  if (/bridge|break/.test(normalized)) return "Break the established pattern with a visual transformation or emotional turn.";
  if (/outro/.test(normalized) || index === total - 1) return "Resolve the visual story with a strong final image.";
  return index < total / 2
    ? "Develop the world and deepen the artist's performance or story."
    : "Escalate the visual idea and move toward the final payoff.";
}

function pickPalette(vision: string, variation: number): string {
  const text = vision.toLowerCase();
  if (/black.?and.?white|monochrome|noir/.test(text)) return "High-contrast black and white, sculpted shadows, silver highlights, and selective film grain.";
  if (/neon|cyber|futur|sci.?fi/.test(text)) return "Deep blacks, electric cyan, magenta, ultraviolet accents, reflective surfaces, and controlled neon bloom.";
  if (/vintage|retro|70s|80s|90s|film/.test(text)) return "Warm faded primaries, amber practicals, tobacco browns, creamy highlights, and tactile analog film texture.";
  if (/nature|forest|desert|ocean|earth/.test(text)) return "Natural earth tones, sunlit skin, organic greens or mineral neutrals, and atmospheric sky color.";
  if (/luxury|fashion|editorial|glam/.test(text)) return "Polished blacks, champagne gold, ivory, jewel-tone accents, glossy highlights, and premium skin tones.";
  if (/dark|moody|goth|horror/.test(text)) return "Crushed blacks, oxblood, cold steel blue, dirty amber, and narrow pools of practical light.";
  if (/bright|happy|summer|colorful/.test(text)) return "Sunlit skin tones, saturated complementary colors, clean whites, and joyful high-key contrast.";
  const defaults = [
    "Deep blacks, warm skin tones, saturated amber, selective cobalt accents, and crisp practical highlights.",
    "Muted jewel tones, soft charcoal shadows, warm practical light, and one bold recurring accent color.",
    "Neutral cinematic blacks, bronze skin tones, cool atmospheric depth, and restrained color pops tied to the chorus.",
  ];
  return defaults[Math.abs(variation) % defaults.length]!;
}

function pickCameraLanguage(vision: string, bpm: number, variation: number): string {
  const text = vision.toLowerCase();
  if (/one.?take|continuous/.test(text)) return "Long choreographed takes, motivated camera handoffs, hidden transitions, and precise blocking around the artist.";
  if (/documentary|raw|street|handheld/.test(text)) return "Intimate handheld coverage, observational inserts, imperfect human movement, direct eye contact, and energetic reframing.";
  if (/dream|surreal|floating|ethereal/.test(text)) return "Slow floating moves, impossible spatial transitions, macro inserts, drifting close-ups, and dreamlike match cuts.";
  if (/dance|performance|concert|stage/.test(text)) return "Hero performance coverage, circular tracking, low-angle pushes, rhythmic close-ups, choreography-aware reframing, and impact cuts.";
  if (/story|narrative|cinematic/.test(text)) return "Motivated narrative coverage, establishing shots, expressive close-ups, visual callbacks, and clear cause-and-effect transitions.";
  const fast = [
    "Dolly pushes, circular tracking, low-angle hero shots, rhythmic handheld accents, and precise match cuts.",
    "Kinetic lateral moves, snap reframes, controlled orbit shots, texture inserts, and chorus-driven visual repetition.",
  ];
  const slow = [
    "Slow dolly movement, intimate portrait close-ups, gentle handheld texture, and motivated reveals.",
    "Measured tracking, shallow-focus portraiture, patient wide shots, and emotionally timed camera movement.",
  ];
  const pool = bpm >= 110 ? fast : slow;
  return pool[Math.abs(variation) % pool.length]!;
}

function buildCreativePlan(
  filename: string | null,
  analysis: AudioAnalysis,
  clips: Clip[],
  vision: string,
  mustInclude: string,
  avoid: string,
  variation: number,
): Pick<DirectorSession, "treatment" | "characterPrompt" | "shots"> {
  const bpm = analysis.bpm ?? 100;
  const key = analysis.key ?? "an undetermined key";
  const title = cleanTitle(filename);
  const trimmedVision = vision.trim();
  const visionLower = trimmedVision.toLowerCase();
  const structure = (analysis.sections ?? []).map((section) => section.label).filter(Boolean).slice(0, 6).join(", ") || "the detected song sections";
  const mode = /story|narrative|plot|journey/.test(visionLower)
    ? "narrative-led"
    : /performance|dance|concert|stage|sing/.test(visionLower)
      ? "performance-led"
      : "concept-led";
  const tempoLanguage = bpm >= 120 ? "fast and propulsive" : bpm >= 90 ? "mid-tempo and controlled" : "slow and atmospheric";
  const variationLanguage = [
    "Build the concept with a clear visual escalation from section to section.",
    "Use recurring visual motifs that transform each time the hook returns.",
    "Balance iconic performance images with unexpected transitional details.",
  ][Math.abs(variation) % 3]!;

  const visualStyle = `A ${mode} music video built directly from your direction: “${trimmedVision}” The song feels ${tempoLanguage} at ${Math.round(bpm)} BPM in ${key}, so the visual rhythm should respond to that energy without overriding your concept. ${variationLanguage}`;
  const logline = `The artist moves through a visual world shaped by this idea: ${trimmedVision}. The imagery evolves across ${structure}, becoming more emotionally and visually ambitious as the song develops.`;
  const includeLine = mustInclude.trim() ? `Required visual elements: ${mustInclude.trim()}.` : "";
  const avoidLine = avoid.trim() ? `Do not include: ${avoid.trim()}.` : "";
  const characterPrompt = [
    `Create the lead recording artist for a music video whose creative direction is: ${trimmedVision}.`,
    "The artist must have a memorable, repeatable identity, realistic skin texture, consistent facial structure, premium wardrobe appropriate to the concept, and confident screen presence.",
    includeLine,
    avoidLine,
    "Provide cinematic full-body and portrait-ready styling, neutral expression, studio-quality music-video lighting, no text, no logos, and no duplicate people.",
  ].filter(Boolean).join(" ");

  const sourceSections = (analysis.sections?.length
    ? analysis.sections
    : [{ label: "song", start: 0, end: analysis.duration }])
    .slice(0, MAX_STORYBOARD_FRAMES);

  const shots: StoryboardShot[] = sourceSections.map((section, index) => {
    const start = section.start ?? clips[index]?.start ?? 0;
    const end = section.end ?? clips[index]?.end ?? analysis.duration ?? start + 5;
    const label = section.label || `Section ${index + 1}`;
    const clipIds = clips
      .filter((clip) => clip.start < end && clip.end > start)
      .map((clip) => clip.id);
    const prompt = [
      `Creative direction: ${trimmedVision}.`,
      sectionArc(label, index, sourceSections.length),
      `For the ${label}, create ${sectionEnergy(label, bpm)}.`,
      includeLine,
      avoidLine,
      "Use the same approved recording artist, stable identity, concept-appropriate wardrobe, strong cinematic composition, realistic skin, detailed environment, premium music-video lighting, 35mm cinema lens, no text, and no logos.",
    ].filter(Boolean).join(" ");
    return {
      id: `shot-${index + 1}`,
      label,
      start,
      end,
      clipIds,
      approved: false,
      prompt,
    };
  });

  return {
    treatment: {
      title: `${title} — ${trimmedVision.slice(0, 58)}${trimmedVision.length > 58 ? "…" : ""}`,
      logline,
      visualStyle,
      colorPalette: pickPalette(trimmedVision, variation),
      cameraLanguage: pickCameraLanguage(trimmedVision, bpm, variation),
    },
    characterPrompt,
    shots,
  };
}

function buildSession(songId: string): DirectorSession {
  return {
    version: DIRECTOR_VERSION,
    songId,
    stage: "vision",
    vision: "",
    mustInclude: "",
    avoid: "",
    treatmentVariation: 0,
    treatmentApproved: false,
    characterApproved: false,
    productionStarted: false,
    lipSyncEnabled: true,
    lipSyncStarted: false,
    lipSyncedClipIds: [],
    treatment: {
      title: "",
      logline: "",
      visualStyle: "",
      colorPalette: "",
      cameraLanguage: "",
    },
    characterPrompt: "",
    shots: [],
  };
}

function taskOutputUrl(task: Task): string | undefined {
  if (task.outputUrl) return task.outputUrl;
  if (Array.isArray(task.output)) return task.output[0];
  return task.output?.videoUrl ?? task.output?.imageUrl ?? task.output?.url;
}

function activeStageIndex(stage: DirectorStage): number {
  return Math.max(0, STAGES.findIndex((item) => item.id === stage));
}

export function AutoDirector() {
  const songId = useStore((state) => state.songId);
  const songFilename = useStore((state) => state.songFilename);
  const audioUrl = useStore((state) => state.audioUrl);
  const analysis = useStore((state) => state.analysis);
  const clips = useStore((state) => state.clips);
  const lookbook = useStore((state) => state.lookbook);
  const projectId = useStore((state) => state.projectId);
  const projectName = useStore((state) => state.projectName);
  const addLookbook = useStore((state) => state.addLookbook);
  const setCharacter = useStore((state) => state.setCharacter);
  const setProjectName = useStore((state) => state.setProjectName);
  const updateClip = useStore((state) => state.updateClip);

  const [session, setSession] = useState<DirectorSession | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [productionNote, setProductionNote] = useState<string | null>(null);
  const [directorError, setDirectorError] = useState<string | null>(null);

  useEffect(() => {
    if (!songId || !analysis || clips.length === 0) {
      setSession(null);
      setOpen(false);
      return;
    }

    const key = storageKey(songId);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as DirectorSession;
        if (parsed.version === DIRECTOR_VERSION && parsed.songId === songId) {
          setSession(parsed);
          return;
        }
      }
    } catch (error) {
      console.warn("Could not restore Auto Director session", error);
    }

    setSession(buildSession(songId));
    setOpen(true);
  }, [songId, analysis, songFilename, clips.length]);

  useEffect(() => {
    if (!session) return;
    localStorage.setItem(storageKey(session.songId), JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (!session || session.stage !== "production" || !session.productionStarted || clips.length === 0) return;
    const allReady = clips.every((clip) => clip.status === "ready" && clip.videoUrl);
    if (allReady) {
      setProductionNote("All production clips are ready for performance sync approval.");
      setSession((current) => current ? { ...current, stage: "lipsync" } : current);
      setOpen(true);
    }
  }, [clips, session?.stage, session?.productionStarted]);

  const progress = useMemo(() => ({
    ready: clips.filter((clip) => clip.status === "ready").length,
    failed: clips.filter((clip) => clip.status === "failed").length,
    active: clips.filter((clip) => clip.status === "queued" || clip.status === "generating").length,
  }), [clips]);

  const performanceClipIds = useMemo(() => {
    const preferred = clips.filter((clip) => /verse|chorus|hook|bridge|vocal/i.test(clip.sectionLabel || ""));
    const pool = preferred.length ? preferred : clips;
    return pool.slice(0, MAX_LIPSYNC_SHOTS).map((clip) => clip.id);
  }, [clips]);

  if (!songId || !analysis || !session) return null;

  const updateSession = (patch: Partial<DirectorSession>) => {
    setSession((current) => current ? { ...current, ...patch } : current);
  };

  const updateTreatment = (key: keyof Treatment, value: string) => {
    setSession((current) => current
      ? { ...current, treatment: { ...current.treatment, [key]: value } }
      : current);
  };

  const createTreatmentFromVision = (variationDelta = 0) => {
    const vision = session.vision.trim();
    if (vision.length < 8) {
      setDirectorError("Describe your vision with at least a short sentence before building the treatment.");
      return;
    }
    const variation = session.treatmentVariation + variationDelta;
    const plan = buildCreativePlan(
      songFilename,
      analysis,
      clips,
      vision,
      session.mustInclude,
      session.avoid,
      variation,
    );
    setDirectorError(null);
    setSession({
      ...session,
      ...plan,
      stage: "treatment",
      treatmentVariation: variation,
      treatmentApproved: false,
      characterApproved: false,
      characterUrl: undefined,
      productionStarted: false,
      lipSyncStarted: false,
      lipSyncedClipIds: [],
      renderUrl: undefined,
    });
  };

  const requestImageWithRetry = async (prompt: string, label: string): Promise<string> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        setBusy(attempt === 1 ? label : "Image service is waking up. Retrying…");
        const result = await startTextToImage({
          promptText: prompt,
          ratio: "16:9",
          model: "sdxl",
        }) as unknown as { imageUrl?: string; url?: string };
        const imageUrl = result.imageUrl ?? result.url;
        if (!imageUrl) throw new Error("The image service returned no image URL.");
        return imageUrl;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || "Image generation failed"));
  };

  const generateCharacter = async () => {
    setDirectorError(null);
    try {
      const imageUrl = await requestImageWithRetry(session.characterPrompt, "Generating character reference…");
      addLookbook(imageUrl);
      setCharacter(imageUrl);
      updateSession({ characterUrl: imageUrl, characterApproved: false });
      void saveImageToLibrary({
        id: `director-character-${crypto.randomUUID().slice(0, 8)}`,
        name: `${cleanTitle(songFilename)} character`,
        url: imageUrl,
        source: "auto-director",
        prompt: session.characterPrompt,
        model: "sdxl",
      }).catch((error) => console.warn("Could not save director character", error));
      toast.success("Character reference generated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDirectorError(message);
      toast.error(`Character generation failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const generateStoryboard = async (onlyShotId?: string) => {
    setDirectorError(null);
    let working = session;
    try {
      for (let index = 0; index < working.shots.length; index += 1) {
        const shot = working.shots[index]!;
        if (onlyShotId && shot.id !== onlyShotId) continue;
        if (!onlyShotId && shot.imageUrl) continue;
        const characterAnchor = working.characterUrl
          ? "Use the exact same approved artist identity and wardrobe from the character reference."
          : working.characterPrompt;
        const imageUrl = await requestImageWithRetry(
          `${characterAnchor} ${shot.prompt}`,
          `Generating storyboard ${index + 1} of ${working.shots.length}: ${shot.label}`,
        );
        addLookbook(imageUrl);
        const nextShots = working.shots.map((item) => item.id === shot.id
          ? { ...item, imageUrl, approved: false }
          : item);
        working = { ...working, shots: nextShots };
        setSession(working);
        void saveImageToLibrary({
          id: `director-board-${crypto.randomUUID().slice(0, 8)}`,
          name: `${shot.label} storyboard`,
          url: imageUrl,
          source: "auto-director-storyboard",
          prompt: shot.prompt,
          model: "sdxl",
        }).catch((error) => console.warn("Could not save storyboard frame", error));
      }
      toast.success(onlyShotId ? "Storyboard frame regenerated" : "Storyboard frames generated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDirectorError(message);
      toast.error(`Storyboard generation stopped: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const approveStoryboard = () => {
    const incomplete = session.shots.some((shot) => !shot.imageUrl || !shot.approved);
    if (incomplete) {
      toast.warning("Generate and approve every storyboard frame first");
      return;
    }

    for (const shot of session.shots) {
      shot.clipIds.forEach((clipId, index) => {
        updateClip(clipId, {
          prompt: `${shot.prompt} Preserve the approved artist identity and storyboard composition.`,
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
  };

  const startProduction = () => {
    const currentClips = useStore.getState().clips;
    if (!currentClips.length) return;
    updateSession({ productionStarted: true });
    setProductionNote("The Director is generating the approved storyboard clips. You can close this window; production continues in the queue.");

    for (const clip of currentClips) {
      const source = clip.source === "continue" ? "continue" : "imageToVideo";
      enqueueGeneration({
        clipId: clip.id,
        source,
        seedImageUrl: clip.archetypeUrl ?? clip.seedImageUrl ?? session.characterUrl ?? lookbook[0] ?? "",
        prompt: clip.prompt || `Cinematic artist performance based on this approved vision: ${session.vision}`,
        duration: clip.end - clip.start,
        sectionLabel: clip.sectionLabel || "song section",
        energy: 0.6,
        model: "ltx-video",
      });
    }
    toast.success("Automated production queue started");
  };

  const retryFailedProduction = () => {
    const failed = useStore.getState().clips.filter((clip) => clip.status === "failed");
    for (const clip of failed) {
      enqueueGeneration({
        clipId: clip.id,
        source: clip.source === "continue" ? "continue" : "imageToVideo",
        seedImageUrl: clip.archetypeUrl ?? clip.seedImageUrl ?? session.characterUrl ?? lookbook[0] ?? "",
        prompt: clip.prompt || `Cinematic artist performance based on this approved vision: ${session.vision}`,
        duration: clip.end - clip.start,
        sectionLabel: clip.sectionLabel || "song section",
        energy: 0.6,
        model: "ltx-video",
      });
    }
  };

  const runLipSync = async () => {
    if (!audioUrl) return;
    setBusy("Starting approved LipDub shots…");
    updateSession({ lipSyncStarted: true });
    let synced = [...session.lipSyncedClipIds];
    try {
      for (let index = 0; index < performanceClipIds.length; index += 1) {
        const clipId = performanceClipIds[index]!;
        if (synced.includes(clipId)) continue;
        const clip = useStore.getState().clips.find((item) => item.id === clipId);
        if (!clip?.videoUrl || clip.status !== "ready") continue;
        setBusy(`Lip-syncing performance shot ${index + 1} of ${performanceClipIds.length}`);
        updateClip(clip.id, { status: "generating", lastError: undefined });
        const task = await startLipSync({
          videoUrl: clip.videoUrl,
          audioUrl,
          audioStart: clip.start,
          audioEnd: clip.end,
          promptText: clip.prompt || "The approved recording artist sings naturally with accurate mouth movement and stable identity.",
          referenceStrength: 1,
          model: "ltx-2.3-lipdub",
        });
        updateClip(clip.id, { generationTaskId: task.id });
        const final = await pollTask(task.id, 4000, 1_800_000);
        const outputUrl = taskOutputUrl(final);
        if ((final.status || "").toUpperCase() !== "SUCCEEDED" || !outputUrl) {
          throw new Error(final.error ?? `LipDub failed for ${clip.sectionLabel || clip.id}`);
        }
        updateClip(clip.id, {
          videoUrl: outputUrl,
          source: "lipSync",
          model: "ltx-2.3-lipdub",
          status: "ready",
          generationTaskId: undefined,
          lastError: undefined,
        });
        synced = [...synced, clip.id];
        setSession((current) => current ? { ...current, lipSyncedClipIds: synced } : current);
        void saveClipToServer({
          id: clip.id,
          name: `${clip.sectionLabel || "performance"} LipDub`,
          videoUrl: outputUrl,
          source: "lipSync",
          prompt: clip.prompt || null,
          duration: clip.end - clip.start,
          sectionLabel: clip.sectionLabel || null,
          model: "ltx-2.3-lipdub",
        }).catch((error) => console.warn("Could not save automated LipDub clip", error));
      }
      updateSession({ stage: "final", lipSyncedClipIds: synced });
      toast.success("Approved performance shots are synchronized");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDirectorError(message);
      toast.error(`Automated LipDub stopped: ${message}`);
      const active = useStore.getState().clips.find((clip) => clip.status === "generating");
      if (active) updateClip(active.id, { status: "ready", generationTaskId: undefined, lastError: message });
    } finally {
      setBusy(null);
    }
  };

  const renderFinal = async () => {
    if (!audioUrl || !analysis.duration) return;
    const ready = useStore.getState().clips
      .filter((clip) => clip.status === "ready" && clip.videoUrl)
      .map((clip) => ({
        start: clip.start,
        end: clip.end,
        videoUrl: clip.videoUrl!,
        source: clip.source,
      }));
    if (!ready.length) {
      toast.warning("No approved clips are ready to render");
      return;
    }

    setBusy("Rendering final approved music video…");
    try {
      const finalProjectId = projectId ?? `proj-${crypto.randomUUID().slice(0, 8)}`;
      if (!projectId) useStore.setState({ projectId: finalProjectId });
      const finalName = projectName || cleanTitle(songFilename);
      if (!projectName) setProjectName(finalName);
      const result = await renderTimeline({
        projectId: finalProjectId,
        audioUrl,
        duration: analysis.duration,
        clips: ready,
        fades: true,
      });
      updateSession({ renderUrl: result.url });
      await saveProjectToServer(finalProjectId, finalName, useStore.getState().getSnapshot());
      toast.success("Final music video rendered and project saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDirectorError(message);
      toast.error(`Final render failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const restartDirector = () => {
    localStorage.removeItem(storageKey(songId));
    setDirectorError(null);
    setSession(buildSession(songId));
    setOpen(true);
  };

  if (!open) {
    return (
      <button type="button" style={directorButtonStyle} onClick={() => setOpen(true)}>
        ✦ Director
      </button>
    );
  }

  const stageIndex = activeStageIndex(session.stage);
  const allBoardsGenerated = session.shots.length > 0 && session.shots.every((shot) => !!shot.imageUrl);
  const allBoardsApproved = session.shots.length > 0 && session.shots.every((shot) => shot.approved);

  return (
    <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.55 }}>Automated production</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>AI Music Video Director</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost" onClick={restartDirector} disabled={!!busy}>Restart</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={!!busy}>Close</button>
          </div>
        </div>

        <div style={stepRowStyle}>
          {STAGES.map((item, index) => (
            <div key={item.id} style={{ ...stepStyle, opacity: index <= stageIndex ? 1 : 0.35 }}>
              <span style={{ ...stepDotStyle, background: index < stageIndex ? "#22c55e" : index === stageIndex ? "#f59e0b" : "#52525b" }} />
              {item.label}
            </div>
          ))}
        </div>

        {busy && <div style={busyStyle}>{busy}</div>}

        <div style={bodyStyle}>
          {directorError && (
            <div style={errorStyle}>
              <strong>Director needs attention</strong>
              <div style={{ marginTop: 5 }}>{directorError}</div>
            </div>
          )}

          {session.stage === "vision" && (
            <section>
              <h3 style={sectionTitleStyle}>1. What is your vision for this video?</h3>
              <p style={helpStyle}>Describe the world, story, mood, locations, performance style, wardrobe, era, camera feeling, or references you have in mind. The Director will build everything else around your words.</p>
              <div style={analysisStripStyle}>
                <Summary label="Tempo" value={`${Math.round(analysis.bpm ?? 0)} BPM`} />
                <Summary label="Key" value={analysis.key || "Unknown"} />
                <Summary label="Sections" value={String(analysis.sections?.length ?? 0)} />
              </div>
              <Field
                label="Your creative vision"
                value={session.vision}
                onChange={(value) => updateSession({ vision: value })}
                multiline
                placeholder="Example: A lonely artist drives through a neon city at night, performing to camera at red lights. The chorus opens into a huge rooftop performance in the rain. Moody, cinematic, futuristic, but still emotional and realistic."
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {VISION_STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="btn ghost"
                    onClick={() => updateSession({ vision: session.vision.trim() ? `${session.vision.trim()} ${starter}.` : `${starter}. ` })}
                  >
                    {starter}
                  </button>
                ))}
              </div>
              <Field
                label="Must include"
                value={session.mustInclude}
                onChange={(value) => updateSession({ mustInclude: value })}
                multiline
                placeholder="Specific locations, props, wardrobe, colors, actions, symbols, or story moments."
              />
              <Field
                label="Avoid"
                value={session.avoid}
                onChange={(value) => updateSession({ avoid: value })}
                multiline
                placeholder="Anything you do not want: crowds, cars, violence, fantasy effects, certain colors, etc."
              />
              <ActionRow>
                <button type="button" className="btn primary" onClick={() => createTreatmentFromVision(0)} disabled={!!busy || session.vision.trim().length < 8}>
                  Build treatment from my vision
                </button>
              </ActionRow>
            </section>
          )}

          {session.stage === "treatment" && (
            <section>
              <h3 style={sectionTitleStyle}>2. Approve the creative treatment</h3>
              <p style={helpStyle}>This treatment is anchored to your vision and shaped by the song's tempo, key, and section structure. Edit anything before approving.</p>
              <div style={visionNoteStyle}><strong>Your direction:</strong> {session.vision}</div>
              <Field label="Treatment title" value={session.treatment.title} onChange={(value) => updateTreatment("title", value)} />
              <Field label="Concept" value={session.treatment.logline} onChange={(value) => updateTreatment("logline", value)} multiline />
              <Field label="Visual style" value={session.treatment.visualStyle} onChange={(value) => updateTreatment("visualStyle", value)} multiline />
              <Field label="Color palette" value={session.treatment.colorPalette} onChange={(value) => updateTreatment("colorPalette", value)} multiline />
              <Field label="Camera language" value={session.treatment.cameraLanguage} onChange={(value) => updateTreatment("cameraLanguage", value)} multiline />
              <ActionRow>
                <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "vision" })}>Edit my vision</button>
                <button type="button" className="btn" onClick={() => createTreatmentFromVision(1)}>Generate another treatment</button>
                <button type="button" className="btn primary" onClick={() => updateSession({ treatmentApproved: true, stage: "character" })}>Approve treatment</button>
              </ActionRow>
            </section>
          )}

          {session.stage === "character" && (
            <section>
              <h3 style={sectionTitleStyle}>3. Approve the main character</h3>
              <p style={helpStyle}>The character brief now inherits your approved vision, required elements, and exclusions. Generate until the identity and wardrobe are right.</p>
              <Field label="Character brief" value={session.characterPrompt} onChange={(value) => updateSession({ characterPrompt: value })} multiline />
              {session.characterUrl && (
                <img
                  src={session.characterUrl}
                  alt="Generated artist reference"
                  style={heroImageStyle}
                  onError={() => setDirectorError("The character was generated, but the image could not be displayed. Use Regenerate character to try again.")}
                />
              )}
              <ActionRow>
                <button type="button" className="btn" onClick={() => void generateCharacter()} disabled={!!busy}>{session.characterUrl ? "Regenerate character" : "Generate character"}</button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!session.characterUrl || !!busy}
                  onClick={() => updateSession({ characterApproved: true, stage: "storyboard" })}
                >
                  Approve character
                </button>
              </ActionRow>
            </section>
          )}

          {session.stage === "storyboard" && (
            <section>
              <h3 style={sectionTitleStyle}>4. Approve the storyboard</h3>
              <p style={helpStyle}>Every section prompt is derived from your vision and adjusted for that part of the song. Regenerate any frame before approval.</p>
              <ActionRow>
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
              </ActionRow>
              <div style={boardGridStyle}>
                {session.shots.map((shot, index) => (
                  <div key={shot.id} style={{ ...boardCardStyle, borderColor: shot.approved ? "rgba(34,197,94,.65)" : "rgba(255,255,255,.12)" }}>
                    {shot.imageUrl
                      ? <img src={shot.imageUrl} alt={`${shot.label} storyboard`} style={boardImageStyle} />
                      : <div style={{ ...boardImageStyle, display: "grid", placeItems: "center", background: "#18181b", color: "#71717a" }}>Frame {index + 1}</div>}
                    <div style={{ padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
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
                      </ActionRow>
                    </div>
                  </div>
                ))}
              </div>
              <ActionRow>
                <button type="button" className="btn primary" disabled={!allBoardsApproved || !!busy} onClick={approveStoryboard}>
                  Approve storyboard and build timeline
                </button>
              </ActionRow>
            </section>
          )}

          {session.stage === "production" && (
            <section>
              <h3 style={sectionTitleStyle}>5. Approve automated clip production</h3>
              <p style={helpStyle}>The Director will generate every timeline clip from the approved storyboard while preserving your vision and continuity between neighboring shots.</p>
              <div style={summaryGridStyle}>
                <Summary label="Ready" value={`${progress.ready}/${clips.length}`} />
                <Summary label="Generating" value={String(progress.active)} />
                <Summary label="Failed" value={String(progress.failed)} />
              </div>
              {productionNote && <div style={noteStyle}>{productionNote}</div>}
              <ActionRow>
                {!session.productionStarted && <button type="button" className="btn primary" onClick={startProduction}>Approve and start production</button>}
                {session.productionStarted && progress.failed > 0 && <button type="button" className="btn" onClick={retryFailedProduction}>Retry failed clips</button>}
                {session.productionStarted && <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Continue in background</button>}
              </ActionRow>
            </section>
          )}

          {session.stage === "lipsync" && (
            <section>
              <h3 style={sectionTitleStyle}>6. Approve performance synchronization</h3>
              <p style={helpStyle}>The Director selected up to {MAX_LIPSYNC_SHOTS} key vocal-performance shots for LTX-2.3 LipDub. This step is optional.</p>
              <div style={summaryGridStyle}>
                <Summary label="Selected shots" value={String(performanceClipIds.length)} />
                <Summary label="Completed" value={String(session.lipSyncedClipIds.length)} />
                <Summary label="Remaining" value={String(Math.max(0, performanceClipIds.length - session.lipSyncedClipIds.length))} />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
                <input type="checkbox" checked={session.lipSyncEnabled} onChange={(event) => updateSession({ lipSyncEnabled: event.target.checked })} />
                Lip-sync selected performance shots to the uploaded song
              </label>
              <ActionRow>
                {session.lipSyncEnabled && <button type="button" className="btn primary" onClick={() => void runLipSync()} disabled={!!busy}>Approve and run LipDub</button>}
                <button type="button" className="btn ghost" onClick={() => updateSession({ stage: "final" })} disabled={!!busy}>Skip LipDub</button>
              </ActionRow>
            </section>
          )}

          {session.stage === "final" && (
            <section>
              <h3 style={sectionTitleStyle}>7. Approve the final cut</h3>
              <p style={helpStyle}>The timeline is ready. Approving this step renders the full song with edge fades, saves the project, and stores the final video in the render library.</p>
              <div style={summaryGridStyle}>
                <Summary label="Timeline clips" value={String(clips.length)} />
                <Summary label="Ready" value={String(progress.ready)} />
                <Summary label="LipDub shots" value={String(session.lipSyncedClipIds.length)} />
              </div>
              {session.renderUrl && (
                <div style={{ marginTop: 20 }}>
                  <video src={session.renderUrl} controls style={{ width: "100%", borderRadius: 12, background: "#000" }} />
                  <a className="btn primary" href={session.renderUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 12 }}>Open final video</a>
                </div>
              )}
              <ActionRow>
                <button type="button" className="btn primary" onClick={() => void renderFinal()} disabled={!!busy || progress.ready === 0}>
                  {session.renderUrl ? "Render updated final cut" : "Approve and render final video"}
                </button>
              </ActionRow>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "block", marginTop: 14 }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: 12, opacity: 0.62 }}>{label}</span>
      {multiline
        ? <textarea value={value} onChange={(event) => onChange(event.target.value)} style={textareaStyle} placeholder={placeholder} />
        : <input value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} placeholder={placeholder} />}
    </label>
  );
}

function ActionRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>{children}</div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 14, borderRadius: 10, background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.08)" }}>
      <div style={{ fontSize: 11, opacity: 0.55 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 500,
  display: "grid",
  placeItems: "center",
  padding: 18,
  background: "rgba(0,0,0,.76)",
  backdropFilter: "blur(8px)",
};

const modalStyle: CSSProperties = {
  width: "min(1080px, 96vw)",
  maxHeight: "92vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: "#fafafa",
  background: "#09090b",
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 16,
  boxShadow: "0 30px 100px rgba(0,0,0,.55)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "18px 20px",
  borderBottom: "1px solid rgba(255,255,255,.08)",
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  padding: "12px 20px",
  borderBottom: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.025)",
};

const stepStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 7, fontSize: 12 };
const stepDotStyle: CSSProperties = { width: 8, height: 8, borderRadius: 999 };
const bodyStyle: CSSProperties = { padding: 20, overflowY: "auto" };
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 18 };
const helpStyle: CSSProperties = { margin: "7px 0 0", opacity: 0.62, lineHeight: 1.5 };
const inputStyle: CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,.13)", background: "#18181b", color: "#fafafa" };
const textareaStyle: CSSProperties = { ...inputStyle, minHeight: 98, resize: "vertical", lineHeight: 1.45 };
const heroImageStyle: CSSProperties = { width: "100%", maxHeight: 430, objectFit: "contain", marginTop: 16, borderRadius: 12, background: "#111" };
const boardGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 14, marginTop: 18 };
const boardCardStyle: CSSProperties = { overflow: "hidden", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.025)" };
const boardImageStyle: CSSProperties = { width: "100%", aspectRatio: "16 / 9", objectFit: "cover" };
const summaryGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 18 };
const analysisStripStyle: CSSProperties = { ...summaryGridStyle, marginTop: 16 };
const noteStyle: CSSProperties = { marginTop: 16, padding: 13, borderRadius: 10, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.28)", color: "#fcd34d" };
const visionNoteStyle: CSSProperties = { marginTop: 16, padding: 13, borderRadius: 10, background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.28)", color: "#bfdbfe", lineHeight: 1.5 };
const errorStyle: CSSProperties = { marginBottom: 16, padding: 13, borderRadius: 10, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.36)", color: "#fecaca", lineHeight: 1.45 };
const busyStyle: CSSProperties = { padding: "10px 20px", background: "rgba(245,158,11,.12)", borderBottom: "1px solid rgba(245,158,11,.25)", color: "#fcd34d", fontSize: 13 };
const directorButtonStyle: CSSProperties = { position: "fixed", right: 18, bottom: 18, zIndex: 250, padding: "11px 16px", borderRadius: 999, border: "1px solid rgba(245,158,11,.55)", background: "#18181b", color: "#fbbf24", fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 35px rgba(0,0,0,.35)" };
