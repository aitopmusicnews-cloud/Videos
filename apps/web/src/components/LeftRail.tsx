import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store.js";
import { saveImageToLibrary } from "../lib/api.js";
import { downloadFromUrl } from "../lib/download.js";
import { AssetUploader } from "./AssetUploader.js";

const LOOKBOOK_MAX = 16;

export function LeftRail() {
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const removeLookbook = useStore((s) => s.removeLookbook);
  const replaceLookbookUrl = useStore((s) => s.replaceLookbookUrl);
  const analysis = useStore((s) => s.analysis);

  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const addReference = (url: string) => {
    addLookbook(url);
    const filename = url.split("/").pop()?.split("?")[0] || "reference-image";
    void saveImageToLibrary({
      id: `img-${crypto.randomUUID().slice(0, 8)}`,
      name: filename,
      url,
      source: "ltx-reference",
      prompt: null,
      model: "ltx-2.3",
    })
      .then((saved) => {
        if (saved.url !== url) replaceLookbookUrl(url, saved.url);
      })
      .catch((error) => console.warn("save LTX reference image failed", error));
  };

  return (
    <aside className="left">
      <div className="section">
        <div className="section-header">
          <span className="label">LTX-2.3 deployment</span>
        </div>
        <div className="context-card">
          <div className="row"><span>Pipeline</span><span>Distilled</span></div>
          <div className="row"><span>Video</span><span>768×512 · 24 FPS</span></div>
          <div className="row"><span>Clip length</span><span>1–5 seconds</span></div>
          <div className="row"><span>Audio</span><span>Native synchronized</span></div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="label">Reference images</span>
          <span className="dim" style={{ fontSize: 11 }}>{lookbook.length}/{LOOKBOOK_MAX}</span>
        </div>
        <div className="rail-help">
          These images are used only for LTX-2.3 image-to-video generations.
        </div>
        <div className="lookbook">
          {lookbook.map((url) => (
            <div
              key={url}
              className="tile filled"
              style={{ backgroundImage: `url(${url})`, cursor: "pointer" }}
              onClick={() => setPreviewUrl(url)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") setPreviewUrl(url);
              }}
            >
              <button
                type="button"
                className="tile-download"
                onClick={(event) => {
                  event.stopPropagation();
                  void downloadFromUrl(url, url.split("/").pop()?.split("?")[0] || "reference.png");
                }}
                title="Download"
                aria-label="Download reference image"
              >
                ↓
              </button>
              <button
                type="button"
                className="tile-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  removeLookbook(url);
                }}
                title="Remove"
                aria-label="Remove reference image"
              >
                ×
              </button>
            </div>
          ))}

          {lookbook.length < LOOKBOOK_MAX && (
            <AssetUploader className="tile add" onUploaded={addReference} onStatus={setUploadStatus}>
              <span className="tile-add-label">{uploadStatus ?? "+"}</span>
            </AssetUploader>
          )}

          {Array.from({ length: Math.max(0, 3 - lookbook.length - 1) }).map((_, index) => (
            <div key={`placeholder-${index}`} className="tile placeholder" />
          ))}
        </div>
      </div>

      {analysis && (
        <div className="section">
          <div className="section-header"><span className="label">Song analysis</span></div>
          <div className="context-card">
            <div className="row"><span>Sections</span><span>{analysis.sections.length}</span></div>
            <div className="row"><span>BPM</span><span>{analysis.bpm.toFixed(1)}</span></div>
            <div className="row"><span>Key</span><span>{analysis.key}</span></div>
            <div className="row"><span>Beats</span><span>{analysis.beats.length}</span></div>
          </div>
        </div>
      )}

      {previewUrl && <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </aside>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="lightbox-overlay"
      onClick={(event) => {
        if (event.target === overlayRef.current) onClose();
      }}
    >
      <img src={url} className="lightbox-img" alt="Reference preview" />
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close preview">×</button>
    </div>
  );
}
