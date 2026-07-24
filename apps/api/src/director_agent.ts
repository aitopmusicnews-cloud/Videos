import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { assertSafeHost } from "./net.js";
import { mimeType, resolveLocalPath } from "./paths.js";
import { storage } from "./storage.js";

const ReferenceKind = z.enum(["character", "style", "location", "shot", "note"]);
const ReferenceMedia = z.enum(["image", "video", "note"]);

export const DirectorReferenceSchema = z.object({
  id: z.string().min(1).max(200),
  kind: ReferenceKind,
  media: ReferenceMedia,
  name: z.string().min(1).max(500),
  anchorUrl: z.string().optional(),
  sourceUrl: z.string().optional(),
  note: z.string().optional(),
}).passthrough();

const DirectorClipSchema = z.object({
  id: z.string().min(1).max(200),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  sectionLabel: z.string().optional(),
}).refine((clip) => clip.end > clip.start, "clip end must be after clip start");

const DirectorAnalysisSchema = z.object({
  bpm: z.number().finite().optional(),
  key: z.string().optional(),
  duration: z.number().finite().positive(),
  sections: z.array(z.object({
    label: z.string().optional(),
    start: z.number().finite().optional(),
    end: z.number().finite().optional(),
  }).passthrough()).optional(),
}).passthrough();

export const DirectorPlanRequestSchema = z.object({
  songId: z.string().min(1).max(500),
  songFilename: z.string().nullable().optional(),
  vision: z.string().min(8),
  mustInclude: z.string().default(""),
  avoid: z.string().default(""),
  characterRequired: z.boolean().default(true),
  characterImageUrl: z.string().optional(),
  analysis: DirectorAnalysisSchema,
  clips: z.array(DirectorClipSchema).min(1).max(80),
  references: z.array(DirectorReferenceSchema).max(20).default([]),
});

export type DirectorPlanRequest = z.infer<typeof DirectorPlanRequestSchema>;

const TreatmentSchema = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  visualStyle: z.string().min(1),
  colorPalette: z.string().min(1),
  cameraLanguage: z.string().min(1),
  continuityStrategy: z.string().min(1),
});

const CharacterBibleSchema = z.object({
  referenceId: z.string().nullable(),
  referenceSummary: z.string(),
  immutableTraits: z.array(z.string()).max(20),
  wardrobe: z.string(),
  prohibitedChanges: z.array(z.string()).max(20),
});

const ShotPlanSchema = z.object({
  clipId: z.string().min(1),
  sectionLabel: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  requiresCharacter: z.boolean(),
  conditioningReferenceId: z.string().nullable(),
  prompt: z.string().min(20),
  continuityNotes: z.string().min(1),
  transition: z.string().min(1),
});

const GeminiDirectorPlanSchema = z.object({
  treatment: TreatmentSchema,
  characterBible: CharacterBibleSchema,
  shots: z.array(ShotPlanSchema).min(1).max(80),
});

export type LtxDirectorPlan = z.infer<typeof GeminiDirectorPlanSchema> & {
  version: "ltx-director-v1";
  agentModel: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    treatment: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        logline: { type: "string" },
        visualStyle: { type: "string" },
        colorPalette: { type: "string" },
        cameraLanguage: { type: "string" },
        continuityStrategy: { type: "string" },
      },
      required: ["title", "logline", "visualStyle", "colorPalette", "cameraLanguage", "continuityStrategy"],
    },
    characterBible: {
      type: "object",
      additionalProperties: false,
      properties: {
        referenceId: { type: ["string", "null"] },
        referenceSummary: { type: "string" },
        immutableTraits: { type: "array", items: { type: "string" }, maxItems: 20 },
        wardrobe: { type: "string" },
        prohibitedChanges: { type: "array", items: { type: "string" }, maxItems: 20 },
      },
      required: ["referenceId", "referenceSummary", "immutableTraits", "wardrobe", "prohibitedChanges"],
    },
    shots: {
      type: "array",
      minItems: 1,
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          clipId: { type: "string" },
          sectionLabel: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          requiresCharacter: { type: "boolean" },
          conditioningReferenceId: { type: ["string", "null"] },
          prompt: { type: "string" },
          continuityNotes: { type: "string" },
          transition: { type: "string" },
        },
        required: [
          "clipId",
          "sectionLabel",
          "start",
          "end",
          "requiresCharacter",
          "conditioningReferenceId",
          "prompt",
          "continuityNotes",
          "transition",
        ],
      },
    },
  },
  required: ["treatment", "characterBible", "shots"],
} as const;

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type PreparedReference = {
  id: string;
  kind: z.infer<typeof ReferenceKind>;
  media: z.infer<typeof ReferenceMedia>;
  name: string;
  note?: string;
  anchorUrl?: string;
};

const MAX_REFERENCE_IMAGES = 10;
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function systemInstruction(): string {
  return [
    "You are an expert music-video director and an LTX-2.3 prompt engineer.",
    "Create a production plan for the exact timeline clips supplied by the application.",
    "Return one and only one shot for every supplied clipId. Never invent, omit, merge, or rename clip IDs.",
    "LTX prompts must be one flowing paragraph, chronological, literal, visually observable, and no more than 190 words.",
    "Each prompt must start directly with the visible action, then describe gestures, exact character appearance, environment, camera framing and movement, lighting, color, and visible changes during the shot.",
    "Do not use abstract marketing language, screenplay headings, bullet points, dialogue formatting, or unsupported model parameters inside prompts.",
    "Character continuity is an asset-conditioning problem, not a promise in prose. For every shot showing the principal artist, set requiresCharacter=true and use the real character reference ID supplied by the application.",
    "Never claim a character is locked when no character reference ID exists. Never invent reference IDs.",
    "Repeat the important immutable facial, hair, wardrobe, and accessory traits naturally inside every character-shot prompt.",
    "Use uploaded style, location, and shot references as visual evidence. Use notes as requirements, not as optional inspiration.",
    "Respect the user's must-include and avoid instructions exactly.",
    "The plan must be practical for independent 1-to-5-second LTX clips that are later edited together.",
  ].join(" ");
}

function requestContext(req: DirectorPlanRequest, references: PreparedReference[]): string {
  return JSON.stringify({
    task: "Create the final editable LTX-2.3 treatment, character bible, and clip-by-clip production prompts.",
    song: {
      id: req.songId,
      filename: req.songFilename,
      bpm: req.analysis.bpm ?? null,
      key: req.analysis.key ?? null,
      duration: req.analysis.duration,
      sections: req.analysis.sections ?? [],
    },
    creativeDirection: {
      vision: req.vision,
      mustInclude: req.mustInclude,
      avoid: req.avoid,
      characterRequired: req.characterRequired,
    },
    validReferenceIds: references.map((reference) => ({
      id: reference.id,
      kind: reference.kind,
      media: reference.media,
      name: reference.name,
      note: reference.note ?? "",
      hasImageCondition: Boolean(reference.anchorUrl),
    })),
    exactTimelineClips: req.clips,
  }, null, 2);
}

async function loadImagePart(rawUrl: string): Promise<{ mimeType: string; data: string }> {
  const localPath = resolveLocalPath(rawUrl);
  if (localPath) {
    const bytes = await readFile(localPath);
    if (bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error("reference image exceeds 12 MB");
    const detected = mimeType(extname(localPath));
    if (!detected.startsWith("image/")) throw new Error("reference asset is not an image");
    return { mimeType: detected, data: bytes.toString("base64") };
  }

  let playable = await storage.playableUrl(rawUrl);
  if (playable.startsWith("/")) {
    if (!config.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is required to load relative reference images");
    playable = new URL(playable, `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/`).toString();
  }

  await assertSafeHost(playable);
  const response = await fetch(playable, {
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`reference image returned ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REFERENCE_BYTES) throw new Error("reference image exceeds 12 MB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error("reference image exceeds 12 MB");
  const detected = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  if (!detected.startsWith("image/")) throw new Error("reference URL did not return an image");
  return { mimeType: detected, data: bytes.toString("base64") };
}

function prepareReferences(req: DirectorPlanRequest): PreparedReference[] {
  const references: PreparedReference[] = req.references.map((reference) => ({
    id: reference.id,
    kind: reference.kind,
    media: reference.media,
    name: reference.name,
    note: reference.note,
    anchorUrl: reference.anchorUrl,
  }));

  if (req.characterImageUrl && !references.some((reference) => reference.anchorUrl === req.characterImageUrl)) {
    references.unshift({
      id: "store-character",
      kind: "character",
      media: "image",
      name: "Approved project character",
      note: "Use this exact person as the principal recording artist.",
      anchorUrl: req.characterImageUrl,
    });
  }

  return references;
}

function validatePlan(
  plan: z.infer<typeof GeminiDirectorPlanSchema>,
  req: DirectorPlanRequest,
  references: PreparedReference[],
): string[] {
  const issues: string[] = [];
  const clipById = new Map(req.clips.map((clip) => [clip.id, clip]));
  const validReferenceIds = new Set(references.filter((reference) => reference.anchorUrl).map((reference) => reference.id));
  const seen = new Set<string>();

  for (const shot of plan.shots) {
    const clip = clipById.get(shot.clipId);
    if (!clip) {
      issues.push(`unknown clipId ${shot.clipId}`);
      continue;
    }
    if (seen.has(shot.clipId)) issues.push(`duplicate clipId ${shot.clipId}`);
    seen.add(shot.clipId);
    if (Math.abs(shot.start - clip.start) > 0.05 || Math.abs(shot.end - clip.end) > 0.05) {
      issues.push(`shot ${shot.clipId} must keep exact times ${clip.start}-${clip.end}`);
    }
    const words = wordCount(shot.prompt);
    if (words > 200) issues.push(`shot ${shot.clipId} prompt has ${words} words; maximum is 200`);
    if (shot.requiresCharacter) {
      if (!shot.conditioningReferenceId) issues.push(`shot ${shot.clipId} requires a character reference ID`);
      else if (!validReferenceIds.has(shot.conditioningReferenceId)) {
        issues.push(`shot ${shot.clipId} uses invalid conditioning reference ${shot.conditioningReferenceId}`);
      }
    } else if (shot.conditioningReferenceId && !validReferenceIds.has(shot.conditioningReferenceId)) {
      issues.push(`shot ${shot.clipId} uses invalid conditioning reference ${shot.conditioningReferenceId}`);
    }
  }

  for (const clip of req.clips) {
    if (!seen.has(clip.id)) issues.push(`missing shot for clipId ${clip.id}`);
  }

  if (plan.shots.length !== req.clips.length) {
    issues.push(`expected ${req.clips.length} shots but received ${plan.shots.length}`);
  }

  if (req.characterRequired) {
    if (!plan.characterBible.referenceId || !validReferenceIds.has(plan.characterBible.referenceId)) {
      issues.push("characterBible.referenceId must use the supplied character conditioning asset");
    }
  }

  return issues;
}

function extractGeminiText(payload: unknown): string {
  const candidates = (payload as any)?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return "";
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim();
}

async function callGemini(parts: GeminiPart[], model: string): Promise<unknown> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.GEMINI_API_KEY!,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction() }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 32768,
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: RESPONSE_SCHEMA,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {
      // Keep the original response text.
    }
    throw new Error(`Gemini Director failed: ${message.slice(0, 800)}`);
  }
  return JSON.parse(text);
}

export async function createDirectorPlan(rawRequest: unknown): Promise<LtxDirectorPlan> {
  if (!config.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured in Render. The LTX Director Agent cannot use a fallback planner.");
  }

  const req = DirectorPlanRequestSchema.parse(rawRequest);
  const references = prepareReferences(req);
  const characterReferences = references.filter((reference) => reference.kind === "character" && reference.anchorUrl);
  if (req.characterRequired && characterReferences.length === 0) {
    throw new Error("Character conditioning is required. Add or approve a character reference before asking the LTX Director Agent to plan the video.");
  }

  const parts: GeminiPart[] = [{ text: requestContext(req, references) }];
  const imageReferences = references.filter((reference) => reference.anchorUrl).slice(0, MAX_REFERENCE_IMAGES);
  for (const reference of imageReferences) {
    try {
      const image = await loadImagePart(reference.anchorUrl!);
      parts.push({ text: `REFERENCE IMAGE ${reference.id} (${reference.kind}): ${reference.name}. ${reference.note ?? ""}` });
      parts.push({ inlineData: image });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (reference.kind === "character" && req.characterRequired) {
        throw new Error(`The required character reference ${reference.name} could not be read: ${message}`);
      }
      parts.push({ text: `REFERENCE ${reference.id} could not be loaded as an image. Use only its note and metadata. Reason: ${message}` });
    }
  }

  const model = config.GEMINI_DIRECTOR_MODEL;
  let correction = "";
  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptParts = correction
      ? [...parts, { text: correction } satisfies GeminiPart]
      : parts;
    const response = await callGemini(attemptParts, model);
    const responseText = extractGeminiText(response);
    if (!responseText) throw new Error("Gemini Director returned no structured plan.");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseText);
    } catch (error) {
      if (attempt === 2) throw new Error(`Gemini Director returned invalid JSON: ${String(error)}`);
      correction = "Your previous answer was not valid JSON. Return only a schema-compliant plan.";
      continue;
    }

    const parsed = GeminiDirectorPlanSchema.safeParse(parsedJson);
    if (!parsed.success) {
      lastIssues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    } else {
      lastIssues = validatePlan(parsed.data, req, references);
      if (lastIssues.length === 0) {
        return {
          ...parsed.data,
          version: "ltx-director-v1",
          agentModel: model,
        };
      }
    }

    correction = [
      "Correct the plan and return the complete JSON object again.",
      "Validation errors:",
      ...lastIssues.map((issue) => `- ${issue}`),
    ].join("\n");
  }

  throw new Error(`Gemini Director could not produce a valid LTX plan: ${lastIssues.join("; ")}`);
}
