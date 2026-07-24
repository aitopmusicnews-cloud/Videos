export function patchDirectorAgentNormalization(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 32768,
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: RESPONSE_SCHEMA,
          },
        },
      },`,
    `      generationConfig: {
        maxOutputTokens: 16384,
        responseFormat: {
          text: {
            mimeType: "APPLICATION_JSON",
          },
        },
      },`,
    "Gemini JSON mode without server-side schema",
  );

  patched = replaceRequired(
    patched,
    `  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {
      // Keep the original response text.
    }
    throw new Error(\`Gemini Director failed: \${message.slice(0, 800)}\`);
  }`,
    `  if (!response.ok) {
    let message = text;
    try {
      const parsedError = JSON.parse(text)?.error;
      const details = parsedError?.details ? \` Details: \${JSON.stringify(parsedError.details)}\` : "";
      message = \`\${parsedError?.message ?? text}\${details}\`;
    } catch {
      // Keep the original response text.
    }
    throw new Error(\`Gemini Director failed: \${message.slice(0, 1600)}\`);
  }`,
    "detailed Gemini API errors",
  );

  const normalizationHelpers = `function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizedStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const values = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (values.length > 0) return values.slice(0, 20);
  }
  return fallback;
}

function normalizeDirectorPlan(
  raw: unknown,
  req: DirectorPlanRequest,
  references: PreparedReference[],
): unknown {
  const root = asRecord(raw);
  const rawTreatment = asRecord(root.treatment);
  const rawBible = asRecord(root.characterBible ?? root.character_bible ?? root.character);
  const rawShots = Array.isArray(root.shots) ? root.shots.map(asRecord) : [];

  const validReferences = references.filter((reference) => reference.anchorUrl);
  const validReferenceIds = new Set(validReferences.map((reference) => reference.id));
  const characterReferences = validReferences.filter((reference) => reference.kind === "character");
  const requestedCharacterId = firstString(rawBible.referenceId, rawBible.reference_id);
  const characterReferenceId = validReferenceIds.has(requestedCharacterId)
    ? requestedCharacterId
    : characterReferences[0]?.id ?? null;
  const characterReference = references.find((reference) => reference.id === characterReferenceId);

  const visualStyle = firstString(
    rawTreatment.visualStyle,
    rawTreatment.visual_style,
    rawTreatment.style,
    root.visualStyle,
    req.vision,
  );
  const title = firstString(
    rawTreatment.title,
    root.title,
    req.songFilename ? req.songFilename.replace(/\\.[^.]+$/, "") : "",
    "Untitled LTX Music Video",
  );

  const rawShotByClipId = new Map<string, Record<string, any>>();
  rawShots.forEach((shot, index) => {
    const clipId = firstString(shot.clipId, shot.clip_id, req.clips[index]?.id);
    if (clipId && !rawShotByClipId.has(clipId)) rawShotByClipId.set(clipId, shot);
  });

  const shots = req.clips.map((clip, index) => {
    const rawShot = rawShotByClipId.get(clip.id) ?? rawShots[index] ?? {};
    const prompt = firstString(
      rawShot.prompt,
      rawShot.ltxPrompt,
      rawShot.ltx_prompt,
      rawShot.direction,
      rawShot.description,
    );
    const requiresCharacter = typeof rawShot.requiresCharacter === "boolean"
      ? rawShot.requiresCharacter
      : typeof rawShot.requires_character === "boolean"
        ? rawShot.requires_character
        : req.characterRequired;
    const requestedReferenceId = firstString(
      rawShot.conditioningReferenceId,
      rawShot.conditioning_reference_id,
      rawShot.referenceId,
      rawShot.reference_id,
    );
    const conditioningReferenceId = requiresCharacter
      ? (validReferenceIds.has(requestedReferenceId) ? requestedReferenceId : characterReferenceId)
      : (validReferenceIds.has(requestedReferenceId) ? requestedReferenceId : null);

    return {
      clipId: clip.id,
      sectionLabel: firstString(
        rawShot.sectionLabel,
        rawShot.section_label,
        clip.sectionLabel,
        "Shot " + String(index + 1),
      ),
      start: clip.start,
      end: clip.end,
      requiresCharacter,
      conditioningReferenceId,
      prompt,
      continuityNotes: firstString(
        rawShot.continuityNotes,
        rawShot.continuity_notes,
        rawShot.continuity,
        requiresCharacter
          ? "Use the same approved character conditioning asset, facial identity, hair, wardrobe, accessories, screen direction, and lighting continuity."
          : "Preserve the preceding clip's dominant color, lighting direction, environment logic, and screen direction.",
      ),
      transition: firstString(
        rawShot.transition,
        rawShot.transitionFromPrevious,
        rawShot.transition_from_previous,
        index === 0
          ? "Open cleanly from black on the first strong visual beat."
          : "Cut on the beat from the previous clip while matching screen direction and dominant color.",
      ),
    };
  });

  return {
    treatment: {
      title,
      logline: firstString(
        rawTreatment.logline,
        rawTreatment.concept,
        root.logline,
        req.vision,
      ),
      visualStyle,
      colorPalette: firstString(
        rawTreatment.colorPalette,
        rawTreatment.color_palette,
        rawTreatment.palette,
        "Use the dominant colors visible in the approved references, with controlled contrast and consistent skin tones.",
      ),
      cameraLanguage: firstString(
        rawTreatment.cameraLanguage,
        rawTreatment.camera_language,
        rawTreatment.camera,
        "Use deliberate cinematic framing and motivated camera movement that can be completed inside each short LTX clip.",
      ),
      continuityStrategy: firstString(
        rawTreatment.continuityStrategy,
        rawTreatment.continuity_strategy,
        rawTreatment.continuity,
        req.characterRequired
          ? "Condition every artist shot with the approved character image and repeat immutable appearance details in each prompt."
          : "Maintain palette, lighting direction, lens language, screen direction, and environment logic across adjacent clips.",
      ),
    },
    characterBible: {
      referenceId: characterReferenceId,
      referenceSummary: firstString(
        rawBible.referenceSummary,
        rawBible.reference_summary,
        rawBible.summary,
        characterReference
          ? "Use the exact person and visible identity from " + characterReference.name + "."
          : "No principal character is required for this plan.",
      ),
      immutableTraits: normalizedStringArray(
        rawBible.immutableTraits ?? rawBible.immutable_traits ?? rawBible.traits,
        characterReference
          ? ["Preserve the exact face, hair, skin tone, body proportions, and identifying features visible in the approved character reference."]
          : [],
      ),
      wardrobe: firstString(
        rawBible.wardrobe,
        rawBible.costume,
        characterReference
          ? "Keep the approved wardrobe, accessories, and grooming consistent unless the user explicitly requests a change."
          : "No locked character wardrobe.",
      ),
      prohibitedChanges: normalizedStringArray(
        rawBible.prohibitedChanges ?? rawBible.prohibited_changes ?? rawBible.avoid,
        characterReference
          ? ["Do not change identity, facial geometry, age, ethnicity, hairstyle, body proportions, wardrobe, or signature accessories."]
          : [],
      ),
    },
    shots,
  };
}`;

  patched = replaceRequired(
    patched,
    "function extractGeminiText(payload: unknown): string {",
    `${normalizationHelpers}

function extractGeminiText(payload: unknown): string {`,
    "Director plan normalization helpers",
  );

  patched = replaceRequired(
    patched,
    `  const parts: GeminiPart[] = [{ text: requestContext(req, references) }];`,
    `  const parts: GeminiPart[] = [
    { text: requestContext(req, references) },
    {
      text: [
        "Return a complete JSON object with treatment, characterBible, and shots.",
        "Each shot must include clipId, requiresCharacter, and prompt.",
        "Also include sectionLabel, start, end, conditioningReferenceId, continuityNotes, and transition when possible.",
        "The application will attach exact immutable clip metadata and validate every prompt before production.",
      ].join(" "),
    },
  ];`,
    "explicit Gemini output contract",
  );

  patched = replaceRequired(
    patched,
    `    const parsed = GeminiDirectorPlanSchema.safeParse(parsedJson);`,
    `    const normalizedJson = normalizeDirectorPlan(parsedJson, req, references);
    const parsed = GeminiDirectorPlanSchema.safeParse(normalizedJson);`,
    "normalize partial Gemini plan before validation",
  );

  patched = replaceRequired(
    patched,
    `      ...lastIssues.map((issue) => \`- \${issue}\`),`,
    `      ...lastIssues.slice(0, 20).map((issue) => \`- \${issue}\`),
      ...(lastIssues.length > 20 ? [\`- ...and \${lastIssues.length - 20} more validation issues\`] : []),`,
    "cap Gemini correction issue list",
  );

  patched = replaceRequired(
    patched,
    `  throw new Error(\`Gemini Director could not produce a valid LTX plan: \${lastIssues.join("; ")}\`);`,
    `  const visibleIssues = lastIssues.slice(0, 20).join("; ");
  const remaining = lastIssues.length > 20 ? \`; plus \${lastIssues.length - 20} more issues\` : "";
  throw new Error(\`Gemini Director could not produce a valid LTX plan: \${visibleIssues}\${remaining}\`);`,
    "concise final Director validation error",
  );

  return patched;
}
