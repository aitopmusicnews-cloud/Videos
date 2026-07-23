import { useState, useCallback, useEffect } from "react";
import {
  startTextToImage,
  pollTask,
  saveImageToLibrary,
} from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { getErrorMessage, type TextToImageModel, type TextToImageRatio } from "@mvs/shared";

const TEXT_TO_IMAGE_MODELS: { value: TextToImageModel; label: string; hint: string }[] = [
  { value: "openrouter_image_ultra", label: "OpenRouter Image Ultra", hint: "high quality, creative · Gemini 2.5 Pro" },
  { value: "openrouter_image_flash", label: "OpenRouter Image Flash", hint: "extremely fast hybrid render · Gemini 2.5 Flash" },
  { value: "local_wan21_image", label: "Wan v2.1 Image (Local)", hint: "local GPU-accelerated generation" },
  { value: "gpt_image_2", label: "GPT Image 2", hint: "OpenAI · up to 4K · 32K char prompts" },
  { value: "gemini_image3_pro", label: "Imagen 3 Pro", hint: "Google · up to 4K+ · character consistency" },
  { value: "gemini_2.5_flash", label: "Gemini Flash", hint: "Google Gemini 2.5 Flash, fast" },
];

const OPENROUTER_RATIOS: TextToImageRatio[] = [
  "1920:1080", "1080:1920", "1280:720", "720:1280", "1024:1024", "1080:1080",
  "1360:768", "1168:880", "1440:1080", "1080:1440", "1808:768", "2112:912",
  "720:720", "960:720", "720:960", "1680:720",
];
const GEMINI_FLASH_RATIOS: TextToImageRatio[] = [
  "1024:1024", "1344:768", "768:1344", "1184:864", "864:1184",
  "1536:672", "832:1248", "1248:832", "896:1152", "1152:896",
];
const GEMINI_PRO_RATIOS: TextToImageRatio[] = [
  "1024:1024", "1344:768", "768:1344", "1184:864", "864:1184",
  "1536:672", "832:1248", "1248:832", "896:1152", "1152:896",
  "2048:2048", "2528:1696", "1696:2528", "2400:1792", "1792:2400",
  "2304:1856", "1856:2304", "2752:1536", "1536:2752", "3168:1344",
  "4096:4096",
];
const GPT_IMAGE_RATIOS: TextToImageRatio[] = [
  "auto",
  "1920:1088", "1920:1920", "1088:1920",
  "1920:1280", "1280:1920", "1920:1440", "1440:1920",
  "1920:1536", "1536:1920",
  "2560:1440", "2560:2560", "1440:2560",
  "2560:1712", "1712:2560", "2560:1920", "1920:2560",
  "2560:2048", "2048:2560",
  "3840:2160", "2880:2880", "2160:3840",
  "2048:880", "2912:1248",
];

function ratiosFor(model: TextToImageModel): TextToImageRatio[] {
  switch (model) {
    case "gemini_2.5_flash": return GEMINI_FLASH_RATIOS;
    case "gemini_image3_pro": return GEMINI_PRO_RATIOS;
    case "gpt_image_2": return GPT_IMAGE_RATIOS;
    default: return OPENROUTER_RATIOS;
  }
}

export function ImageGenerator({
  lookbook,
  onDone,
  onRehosted,
}: {
  lookbook: string[];
  onDone: (url: string) => void;
  onRehosted: (oldUrl: string, newUrl: string) => void;
}) {
  const [model, setModel] = useState<TextToImageModel>("openrouter_image_flash");
  const [ratio, setRatio] = useState<TextToImageRatio>("1920:1080");
  const [prompt, setPrompt] = useState("");
  const [useRefs, setUseRefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const ratios = ratiosFor(model);
  useEffect(() => {
    if (!ratios.includes(ratio)) setRatio(ratios[0]!);
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const turboNeedsRefs = false;
  const refsAvailable = lookbook.length > 0;
  const effectiveUseRefs = useRefs || turboNeedsRefs;
  const maxRefs = model === "gpt_image_2" ? 16 : model === "gemini_image3_pro" ? 14 : 3;
  const canGenerate =
    !busy &&
    prompt.trim().length > 0 &&
    (!turboNeedsRefs || refsAvailable);

  const onGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setBusy(true);
    setError(null);
    setProgressLabel("queued");
    try {
      const referenceImages = effectiveUseRefs && refsAvailable
        ? lookbook.slice(0, maxRefs).map((uri) => ({ uri }))
        : undefined;
      const payload: any = {
        prompt: prompt.trim(),
        promptText: prompt.trim(),
        model,
        ratio,
        ...(referenceImages ? { referenceImages } : {}),
      };
      const { id } = await startTextToImage(payload);
      setProgressLabel("generating…");
      const task = await pollTask(id);
      const imageUrl = task.outputUrl || (task.output as any)?.imageUrl || (task.output as any)?.[0] || (task.output as any)?.url;
      if ((task.status || "").toUpperCase() !== "SUCCEEDED" || !imageUrl) {
        throw new Error(task.error ?? `task ${(task.status || "").toLowerCase()}`);
      }
      onDone(imageUrl);
      toast.success("Image added to lookbook");
      setPrompt("");

      void saveImageToLibrary({
        id: `img-${crypto.randomUUID().slice(0, 8)}`,
        name: prompt.trim().slice(0, 60),
        url: imageUrl,
        source: "generated",
        prompt: prompt.trim(),
        model,
      })
        .then((saved) => {
          if (saved.url !== imageUrl) onRehosted(imageUrl, saved.url);
        })
        .catch((err) => console.warn("auto-save image to library failed", err));
    } catch (err) {
      const msg = getErrorMessage(err).slice(0, 140);
      setError(msg);
      toast.error(`Generation failed: ${msg}`);
    } finally {
      setBusy(false);
      setProgressLabel(null);
    }
  }, [canGenerate, effectiveUseRefs, refsAvailable, lookbook, prompt, model, ratio, maxRefs, onDone]);

  return (
    <div className="image-generator">
      <textarea
        className="prompt"
        placeholder="Describe the image…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        disabled={busy}
      />
      <div className="image-generator-row">
        <select
          className="select"
          value={model}
          onChange={(e) => setModel(e.target.value as TextToImageModel)}
          disabled={busy}
        >
          {TEXT_TO_IMAGE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          className="select"
          value={ratio}
          onChange={(e) => setRatio(e.target.value as TextToImageRatio)}
          disabled={busy}
        >
          {ratios.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <label className="continuity-toggle">
        <input
          type="checkbox"
          checked={effectiveUseRefs && refsAvailable}
          onChange={(e) => setUseRefs(e.target.checked)}
          disabled={busy || turboNeedsRefs || !refsAvailable}
        />
        <span>
          Use lookbook as references
          {turboNeedsRefs && <span className="dim"> (required for Turbo)</span>}
          {!refsAvailable && <span className="dim"> (no images yet)</span>}
          {refsAvailable && effectiveUseRefs && (
            <span className="dim"> ({Math.min(maxRefs, lookbook.length)} sent)</span>
          )}
        </span>
      </label>
      {turboNeedsRefs && !refsAvailable && (
        <div className="cast-error">Turbo needs at least one lookbook image. Upload one or pick another model.</div>
      )}
      {error && <div className="cast-error">{error}</div>}
      <div className="sidebar-footer">
        <button
          type="button"
          className="generate-btn"
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          {busy ? (progressLabel ?? "working…") : "Generate image"}
        </button>
      </div>
    </div>
  );
}
