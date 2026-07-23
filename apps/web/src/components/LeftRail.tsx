import { useState, useCallback, useEffect, useRef } from "react";
import { useStore } from "../lib/store.js";
import {
  createAvatar,
  pollAvatar,
  listAvatars,
  saveImageToLibrary,
  type AvatarSummary,
} from "../lib/api.js";
import { downloadFromUrl } from "../lib/download.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";
import { getErrorMessage } from "@mvs/shared";

const LOOKBOOK_MAX = 16;

type CastMode = "idle" | "browse";

export function LeftRail() {
  const character = useStore((s) => s.characterImageUrl);
  const setCharacter = useStore((s) => s.setCharacter);
  const setAvatarId = useStore((s) => s.setAvatarId);
  const setAvatarName = useStore((s) => s.setAvatarName);
  const setAvatarStatus = useStore((s) => s.setAvatarStatus);
  const pickAvatar = useStore((s) => s.pickAvatar);
  const avatarId = useStore((s) => s.avatarId);
  const avatarName = useStore((s) => s.avatarName);
  const avatarStatus = useStore((s) => s.avatarStatus);
  const avatarError = useStore((s) => s.avatarError);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const removeLookbook = useStore((s) => s.removeLookbook);
  const replaceLookbookUrl = useStore((s) => s.replaceLookbookUrl);
  const analysis = useStore((s) => s.analysis);

  const [lookbookStatus, setLookbookStatus] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [mode, setMode] = useState<CastMode>("idle");
  const [existingAvatars, setExistingAvatars] = useState<AvatarSummary[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const avatarLoading = avatarStatus === "creating";
  const hasAvatar = !!avatarId && avatarStatus === "ready";

  const openBrowse = useCallback(() => {
    setMode("browse");
    setLoadingList(true);
    listAvatars()
      .then((a) => setExistingAvatars(a))
      .catch(() => setExistingAvatars([]))
      .finally(() => setLoadingList(false));
  }, []);

  const onImageUploaded = useCallback((url: string) => {
    setCharacter(url);
    setMode("idle");
  }, [setCharacter]);

  const onCreateAvatar = useCallback(async () => {
    if (!character || !nameInput.trim()) return;
    const name = nameInput.trim();
    setAvatarStatus("creating");
    setAvatarName(name);
    try {
      // Two-step: submit returns immediately with PROCESSING; poll until
      // READY. The server can't hold the HTTP connection open for the
      // 30–90s Runway processing window — CloudFront's origin response
      // timeout (60s default) would cut us off first.
      const submitted = await createAvatar(character, name);
      // Stash the avatar id right away so a refresh keeps the polling
      // context. The status stays "creating" until READY/FAILED.
      setAvatarId(submitted.avatarId);
      setNameInput("");

      if (submitted.status === "FAILED") {
        const reason = submitted.failureReason ?? "unknown";
        setAvatarStatus("failed", reason);
        toast.error(`Avatar creation failed: ${reason.slice(0, 80)}`);
        return;
      }
      if (submitted.status === "READY") {
        toast.success(`Avatar "${name}" ready`);
        return;
      }
      // PROCESSING — poll until terminal.
      const final = await pollAvatar(submitted.avatarId);
      if (final.status === "FAILED") {
        const reason = final.failureReason ?? "unknown";
        setAvatarStatus("failed", reason);
        toast.error(`Avatar creation failed: ${reason.slice(0, 80)}`);
        return;
      }
      toast.success(`Avatar "${name}" ready`);
    } catch (err) {
      const msg = getErrorMessage(err).slice(0, 80);
      setAvatarStatus("failed", msg);
      toast.error(`Avatar creation failed: ${msg}`);
    }
  }, [character, nameInput, setAvatarStatus, setAvatarName, setAvatarId]);

  const onPickExisting = useCallback((a: AvatarSummary) => {
    pickAvatar(a.id, a.name, a.imageUri);
    setMode("idle");
    setNameInput("");
  }, [pickAvatar]);

  const onClear = useCallback(() => {
    setCharacter(null);
    setNameInput("");
    setMode("idle");
  }, [setCharacter]);

  useEffect(() => {
    if (avatarName && !nameInput) setNameInput(avatarName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needsName = !!character && !avatarId && !avatarLoading && mode === "idle";
  const canCreate = !!character && !!nameInput.trim() && !avatarLoading;

  const readyAvatars = existingAvatars?.filter((a) => a.status === "READY") ?? [];

  return (
    <aside className="left">
      <div className="section">
        <div className="section-header">
          <span className="label">Character</span>
          {(character || hasAvatar) && (
            <button type="button" className="add" onClick={onClear}>clear</button>
          )}
        </div>

        {mode === "browse" ? (
          <AvatarPicker
            avatars={readyAvatars}
            loading={loadingList}
            currentId={avatarId}
            onPick={onPickExisting}
            onNew={() => setMode("idle")}
          />
        ) : (
          <>
            <AssetUploader
              className={`cast-card${avatarLoading ? " loading" : ""}`}
              onUploaded={onImageUploaded}
            >
              <div className="thumb-wrap">
                {character ? (
                  <img
                    src={character}
                    className="thumb"
                    alt=""
                    onClick={(e) => { e.stopPropagation(); setPreviewUrl(character); }}
                    style={{ cursor: "pointer" }}
                  />
                ) : (
                  <div className="thumb placeholder" />
                )}
                {avatarLoading && (
                  <div className="thumb-spinner">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="50 20" />
                    </svg>
                  </div>
                )}
                {hasAvatar && !avatarLoading && (
                  <div className="thumb-badge" title="Avatar ready" />
                )}
              </div>
              <div className="cast-info">
                <div className="cast-name">
                  {avatarLoading
                    ? "Creating avatar…"
                    : avatarName ?? (character ? "Unnamed" : "Drop or click")}
                </div>
                <div className="cast-role">
                  {character
                    ? avatarLoading
                      ? "Building avatar for lip-sync…"
                      : avatarStatus === "failed"
                        ? avatarError ?? "Avatar creation failed"
                        : hasAvatar
                          ? "Avatar ready"
                          : "Name your character below"
                    : "image · the singer"}
                </div>
              </div>
            </AssetUploader>

            {needsName && (
              <div className="cast-name-form">
                <input
                  type="text"
                  className="cast-name-input"
                  placeholder="Character name…"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onCreateAvatar(); }}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canCreate}
                  onClick={onCreateAvatar}
                >
                  Create
                </button>
              </div>
            )}

            {avatarStatus === "failed" && (
              <div className="cast-error">
                {avatarError ?? "Failed"} —{" "}
                <button type="button" className="add" onClick={onCreateAvatar}>retry</button>
              </div>
            )}

            {!character && !avatarLoading && (
              <button type="button" className="cast-alt-action" onClick={openBrowse}>
                or load an existing character
              </button>
            )}

            {hasAvatar && (
              <button type="button" className="cast-alt-action" onClick={openBrowse}>
                switch character
              </button>
            )}
          </>
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <span className="label">Lookbook</span>
          <span className="dim" style={{ fontSize: 11 }}>
            {lookbook.length}/{LOOKBOOK_MAX}
          </span>
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
              onKeyDown={(e) => { if (e.key === "Enter") setPreviewUrl(url); }}
            >
              <button
                type="button"
                className="tile-download"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadFromUrl(url, url.split("/").pop()?.split("?")[0] || "image.png");
                }}
                title="download"
                aria-label="download tile"
              >
                ↓
              </button>
              <button
                type="button"
                className="tile-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLookbook(url);
                }}
                title="remove"
                aria-label="remove tile"
              >
                ×
              </button>
            </div>
          ))}
          {lookbook.length < LOOKBOOK_MAX && (
            <AssetUploader
              className="tile add"
              onUploaded={(url) => {
                addLookbook(url);
                // Save to the image library so uploads are browsable alongside
                // generated images. The server rehosts external URLs into
                // /storage/images; if the saved URL differs (rehost happened
                // or path normalized), swap the lookbook entry to match so
                // we don't keep pointing at the original.
                const fname = url.split("/").pop()?.split("?")[0] || "image";
                void saveImageToLibrary({
                  id: `img-${crypto.randomUUID().slice(0, 8)}`,
                  name: fname,
                  url,
                  source: "uploaded",
                  prompt: null,
                  model: null,
                })
                  .then((saved) => {
                    if (saved.url !== url) replaceLookbookUrl(url, saved.url);
                  })
                  .catch((err) => console.warn("save uploaded image to library failed", err));
              }}
              onStatus={setLookbookStatus}
            >
              <span className="tile-add-label">{lookbookStatus ?? "+"}</span>
            </AssetUploader>
          )}
          {Array.from({ length: Math.max(0, 3 - lookbook.length - 1) }).map((_, i) => (
            <div key={`ph-${i}`} className="tile placeholder" />
          ))}
        </div>
      </div>

      {analysis && (
        <div className="section">
          <div className="section-header">
            <span className="label">Audio analysis</span>
          </div>
          <div className="context-card">
            <div className="row"><span>Sections</span><span>{analysis.sections.length}</span></div>
            <div className="row"><span>BPM</span><span>{analysis.bpm.toFixed(1)}</span></div>
            <div className="row"><span>Key</span><span>{analysis.key}</span></div>
            <div className="row"><span>Beats</span><span>{analysis.beats.length}</span></div>
          </div>
        </div>
      )}
      {previewUrl && (
        <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}
    </aside>
  );
}

function AvatarPicker({
  avatars,
  loading,
  currentId,
  onPick,
  onNew,
}: {
  avatars: AvatarSummary[];
  loading: boolean;
  currentId: string | null;
  onPick: (a: AvatarSummary) => void;
  onNew: () => void;
}) {
  return (
    <div className="avatar-picker">
      <div className="avatar-picker-head">
        <span className="avatar-picker-title">Select a character</span>
        <button type="button" className="add" onClick={onNew}>
          new
        </button>
      </div>
      {loading ? (
        <div className="avatar-picker-msg">Loading…</div>
      ) : !avatars.length ? (
        <div className="avatar-picker-msg">
          No avatars yet.{" "}
          <button type="button" className="add" onClick={onNew}>
            Create one
          </button>
        </div>
      ) : (
        <div className="avatar-list">
          {avatars.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`avatar-item${a.id === currentId ? " selected" : ""}`}
              onClick={() => onPick(a)}
            >
              {a.imageUri ? (
                <img src={a.imageUri} className="avatar-item-thumb" alt="" />
              ) : (
                <div className="avatar-item-thumb placeholder" />
              )}
              <div className="avatar-item-info">
                <div className="avatar-item-name">{a.name}</div>
                <div className="avatar-item-date">
                  {new Date(a.createdAt).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="lightbox-overlay"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <img src={url} className="lightbox-img" alt="" />
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="close">
        ×
      </button>
    </div>
  );
}
