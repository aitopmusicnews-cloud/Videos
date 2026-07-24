export function patchDirectorAgentRuntime(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `    seedImageUrl: string;
    prompt: string;`,
    `    seedImageUrl: string;
    requiresCharacter: boolean;
    prompt: string;`,
    "queued job character requirement",
  );

  patched = replaceRequired(
    patched,
    `  seedImageUrl: string;
  prompt: string;`,
    `  seedImageUrl: string;
  requiresCharacter?: boolean;
  prompt: string;`,
    "enqueue character requirement",
  );

  patched = replaceRequired(
    patched,
    `      seedImageUrl: input.seedImageUrl,
      prompt: input.prompt,`,
    `      seedImageUrl: input.seedImageUrl,
      requiresCharacter: input.requiresCharacter === true,
      prompt: input.prompt,`,
    "persist character requirement in queue",
  );

  patched = replaceRequired(
    patched,
    `  if (job.input.source === "textToVideo") {
    return startTextToVideo({`,
    `  if (job.input.requiresCharacter && job.input.source === "textToVideo") {
    throw new Error("Character conditioning is required. This clip cannot fall back to text-to-video.");
  }

  if (job.input.source === "textToVideo") {
    return startTextToVideo({`,
    "block character text fallback",
  );

  patched = replaceRequired(
    patched,
    `  if (!firstFrame) throw new Error("Image-to-video requires a first-frame reference");

  return startImageToVideo({`,
    `  if (!firstFrame) {
    throw new Error(job.input.requiresCharacter
      ? "Character conditioning is required. No character image was attached."
      : "Image-to-video requires a first-frame reference");
  }

  return startImageToVideo({`,
    "strict first frame validation",
  );

  patched = replaceRequired(
    patched,
    `    promptImage: firstFrame,
    promptText,`,
    `    promptImage: firstFrame,
    characterRequired: job.input.requiresCharacter,
    promptText,`,
    "send character requirement to API",
  );

  return patched;
}

export function patchDirectorAgentComponent(source, replaceRequired) {
  return replaceRequired(
    source,
    `  const updateCharacterBible = (key: keyof CharacterBible, value: CharacterBible[keyof CharacterBible]) => {`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {`,
    "typed character bible editor",
  );
}

export function patchDirectorReferenceChat(source, replaceRequired) {
  return replaceRequired(
    source,
    `  useEffect(() => {
    if (!songId) return;
    localStorage.setItem(storageKey(songId), JSON.stringify(items));
  }, [items, songId]);

  if (!songId) return null;`,
    `  useEffect(() => {
    if (!songId) return;
    localStorage.setItem(storageKey(songId), JSON.stringify(items));
  }, [items, songId]);

  useEffect(() => {
    const openFromDirector = () => setOpen(true);
    window.addEventListener("mvs-open-reference-chat", openFromDirector);
    return () => window.removeEventListener("mvs-open-reference-chat", openFromDirector);
  }, []);

  if (!songId) return null;`,
    "open Reference Chat from LTX Director Agent",
  );
}
