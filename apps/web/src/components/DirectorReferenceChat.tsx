import { useEffect, useRef, useState, type CSSProperties } from "react";
import { extractLastFrame, uploadImage, uploadVideo } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

type ReferenceKind = "character" | "style" | "location" | "shot";
type ReferenceMedia = "image" | "video" | "note";
type ReferenceStatus = "uploading" | "extracting" | "ready" | "failed";

type ReferenceItem = {
  id: string;
  kind: ReferenceKind | "note";
  media: ReferenceMedia;
  name: string;
  url?: string;
  anchorUrl?: string;
  note?: string;
  status?: ReferenceStatus;
  progress?: number;
  error?: string;
  createdAt: number;
};

type DirectorReferenceDetail = {
  kind: ReferenceKind | "note";
  media: ReferenceMedia;
  name?: string;
  url?: string;
  sourceUrl?: string;
  note?: string;
};

type BatchProgress = {
  label: string;
  current: number;
  total: number;
  percent: number;
};

const REFERENCE_EVENT = "mvs-director-reference";
const MAX_REFERENCE_FILES = 12;

function storageKey(songId: string): string {
  return `mvs-director-reference-chat-v1-${songId}`;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
}

function isVideo(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
}

function dispatchReference(detail: DirectorReferenceDetail): void {
  window.dispatchEvent(new CustomEvent<DirectorReferenceDetail>(REFERENCE_EVENT, { detail }));
}

function statusLabel(status: ReferenceStatus): string {
  if (status === "uploading") return "Uploading";
  if (status === "extracting") return "Preparing video frame";
  if (status === "failed") return "Failed";
  return "Ready for Director";
}

function statusFill(status: ReferenceStatus): string {
  if (status === "failed") return "#ef4444";
  if (status === "ready") return "#22c55e";
  return "#3b82f6";
}

export function DirectorReferenceChat() {
  const songId = useStore((state) => state.songId);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<ReferenceKind>("style");
  const [uploading, setUploading] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!songId) {
      setItems([]);
      setOpen(false);
      setBatchProgress(null);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey(songId));
      const parsed = raw ? JSON.parse(raw) as ReferenceItem[] : [];
      const restored = Array.isArray(parsed)
        ? parsed.map((item) => {
            if (item.status === "uploading" || item.status === "extracting") {
              return {
                ...item,
                status: "failed" as const,
                progress: 100,
                error: "Processing was interrupted. Choose this file again.",
              };
            }
            return {
              ...item,
              status: item.media === "note" ? undefined : item.status ?? "ready",
              progress: item.media === "note" ? undefined : item.progress ?? 100,
            };
          })
        : [];
      setItems(restored);
    } catch (error) {
      console.warn("Could not restore Director reference chat", error);
      setItems([]);
    }
  }, [songId]);

  useEffect(() => {
    if (!songId) return;
    localStorage.setItem(storageKey(songId), JSON.stringify(items));
  }, [items, songId]);

  if (!songId) return null;

  const updateItem = (id: string, patch: Partial<ReferenceItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const updateBatch = (index: number, total: number, fraction: number, label: string) => {
    setBatchProgress({
      label,
      current: Math.min(total, index + 1),
      total,
      percent: Math.min(100, Math.max(1, Math.round(((index + fraction) / total) * 100))),
    });
  };

  const sendNote = () => {
    const note = draft.trim();
    if (!note) return;
    const item: ReferenceItem = {
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      kind: "note",
      media: "note",
      name: "Creative note",
      note,
      createdAt: Date.now(),
    };
    setItems((current) => [...current, item]);
    dispatchReference({ kind: "note", media: "note", name: item.name, note });
    setDraft("");
    toast.success("Creative note sent to the Director");
  };

  const applyReference = (item: ReferenceItem, nextKind: ReferenceKind = item.kind === "note" ? "style" : item.kind) => {
    if (item.media === "note") {
      dispatchReference({ kind: "note", media: "note", name: item.name, note: item.note });
      toast.success("Creative note sent to the Director");
      return;
    }
    if ((item.status ?? "ready") !== "ready") {
      toast.error("Wait for this reference to finish processing");
      return;
    }
    const anchorUrl = item.anchorUrl ?? (item.media === "image" ? item.url : undefined);
    if (!anchorUrl) {
      toast.error("This video does not have a usable reference frame yet");
      return;
    }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, kind: nextKind } : entry));
    dispatchReference({
      kind: nextKind,
      media: item.media,
      name: item.name,
      url: anchorUrl,
      sourceUrl: item.url,
      note: item.note,
    });
    toast.success(nextKind === "character" ? "Character reference applied" : `${nextKind} reference sent to the Director`);
  };

  const uploadFiles = async (files: File[]) => {
    const accepted = files.filter((file) => isImage(file) || isVideo(file)).slice(0, MAX_REFERENCE_FILES);
    if (!accepted.length) {
      toast.error("Choose an image or video file");
      return;
    }

    setOpen(true);
    for (let index = 0; index < accepted.length; index += 1) {
      const file = accepted[index]!;
      const id = `ref-${crypto.randomUUID().slice(0, 8)}`;
      const media: ReferenceMedia = isImage(file) ? "image" : "video";
      const pending: ReferenceItem = {
        id,
        kind,
        media,
        name: file.name,
        note: draft.trim() || undefined,
        status: "uploading",
        progress: 5,
        createdAt: Date.now(),
      };
      setItems((current) => [...current, pending]);
      setUploading(`Uploading ${index + 1} of ${accepted.length}: ${file.name}`);
      updateBatch(index, accepted.length, 0.05, `Uploading ${file.name}`);

      try {
        let completed: ReferenceItem;
        if (media === "image") {
          updateItem(id, { progress: 20 });
          const uploaded = await uploadImage(file);
          updateItem(id, { url: uploaded.url, anchorUrl: uploaded.url, progress: 85 });
          updateBatch(index, accepted.length, 0.85, `Applying ${file.name} to the Director`);
          completed = {
            ...pending,
            url: uploaded.url,
            anchorUrl: uploaded.url,
            status: "ready",
            progress: 100,
          };
        } else {
          updateItem(id, { progress: 20 });
          const uploaded = await uploadVideo(file);
          updateItem(id, {
            url: uploaded.url,
            status: "extracting",
            progress: 65,
          });
          setUploading(`Extracting reference frame: ${file.name}`);
          updateBatch(index, accepted.length, 0.65, `Preparing a usable frame from ${file.name}`);
          const anchorUrl = (await extractLastFrame(uploaded.url)).url;
          completed = {
            ...pending,
            url: uploaded.url,
            anchorUrl,
            status: "ready",
            progress: 100,
          };
        }

        updateItem(id, completed);
        const anchorUrl = completed.anchorUrl ?? (completed.media === "image" ? completed.url : undefined);
        if (anchorUrl) {
          dispatchReference({
            kind,
            media: completed.media,
            name: completed.name,
            url: anchorUrl,
            sourceUrl: completed.url,
            note: completed.note,
          });
        }
        updateBatch(index, accepted.length, 1, `${file.name} is ready`);
        toast.success(`${file.name} added as a ${kind} reference`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateItem(id, {
          status: "failed",
          progress: 100,
          error: message,
        });
        updateBatch(index, accepted.length, 1, `${file.name} failed`);
        toast.error(`Reference upload failed: ${message}`);
      }
    }

    setDraft("");
    setUploading(null);
    setBatchProgress((current) => current ? { ...current, label: "Reference processing complete", percent: 100 } : current);
    window.setTimeout(() => setBatchProgress(null), 1400);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  if (!open) {
    return (
      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>
        ＋ References
        {uploading && <span style={activityDotStyle} aria-label="Reference processing active" />}
        {items.length > 0 && <span style={countStyle}>{items.length}</span>}
      </button>
    );
  }

  return (
    <aside style={panelStyle} aria-label="Director reference chat">
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Director inputs</div>
          <strong style={{ fontSize: 17 }}>Reference Chat</strong>
        </div>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
      </header>

      {batchProgress && (
        <div style={batchProgressStyle} role="status" aria-live="polite">
          <div style={progressHeaderStyle}>
            <span>{batchProgress.label}</span>
            <strong>{batchProgress.percent}%</strong>
          </div>
          <div style={progressTrackStyle}>
            <div style={{ ...progressFillStyle, width: `${batchProgress.percent}%` }} />
          </div>
          <div style={progressMetaStyle}>File {batchProgress.current} of {batchProgress.total}</div>
        </div>
      )}

      <div style={messagesStyle}>
        <div style={assistantBubbleStyle}>
          Upload character photos, visual references, locations, wardrobe, shot examples, or videos. Add a note explaining what the Director should borrow from each reference.
        </div>

        {items.length === 0 && (
          <div style={emptyStyle}>No references uploaded for this song yet.</div>
        )}

        {items.map((item) => {
          const itemStatus = item.status ?? "ready";
          const itemProgress = item.progress ?? 100;
          return (
            <article key={item.id} style={userBubbleStyle}>
              <div style={assetHeaderStyle}>
                <span style={tagStyle}>{item.kind === "note" ? "creative note" : `${item.kind} reference`}</span>
                <button type="button" style={removeStyle} onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>×</button>
              </div>

              {item.media === "image" && item.url && (
                <img src={item.url} alt={item.name} style={imageStyle} />
              )}
              {item.media === "video" && item.url && (
                <video src={item.url} controls preload="metadata" style={videoStyle} />
              )}

              <strong style={{ display: "block", marginTop: item.media === "note" ? 0 : 9 }}>{item.name}</strong>
              {item.note && <div style={noteStyle}>{item.note}</div>}

              {item.media !== "note" && (
                <div style={itemProgressStyle}>
                  <div style={progressHeaderStyle}>
                    <span>{statusLabel(itemStatus)}</span>
                    <strong>{itemProgress}%</strong>
                  </div>
                  <div style={progressTrackStyle}>
                    <div style={{ ...progressFillStyle, width: `${itemProgress}%`, background: statusFill(itemStatus) }} />
                  </div>
                </div>
              )}

              {item.error && <div style={errorStyle}>{item.error}</div>}
              {item.media === "video" && itemStatus === "ready" && !item.anchorUrl && (
                <div style={warningStyle}>The video uploaded, but its reference frame could not be extracted.</div>
              )}

              {item.media !== "note" && (
                <div style={actionsStyle}>
                  <button type="button" className="btn ghost" disabled={itemStatus !== "ready"} onClick={() => applyReference(item, "character")}>Use as character</button>
                  <button type="button" className="btn ghost" disabled={itemStatus !== "ready"} onClick={() => applyReference(item, "style")}>Style</button>
                  <button type="button" className="btn ghost" disabled={itemStatus !== "ready"} onClick={() => applyReference(item, "location")}>Location</button>
                  <button type="button" className="btn ghost" disabled={itemStatus !== "ready"} onClick={() => applyReference(item, "shot")}>Shot</button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div
        style={composerStyle}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <label style={labelStyle}>
          Reference type
          <select value={kind} onChange={(event) => setKind(event.target.value as ReferenceKind)} style={selectStyle}>
            <option value="character">Character</option>
            <option value="style">Visual style</option>
            <option value="location">Location</option>
            <option value="shot">Shot or movement</option>
          </select>
        </label>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tell the Director what to borrow from the reference, or send this as a creative note…"
          style={textareaStyle}
        />

        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))}
        />

        {uploading && <div style={uploadingStyle}>{uploading}</div>}

        <div style={composerActionsStyle}>
          <button type="button" className="btn" disabled={!!uploading} onClick={() => inputRef.current?.click()}>
            Upload image or video
          </button>
          <button type="button" className="btn primary" disabled={!draft.trim() || !!uploading} onClick={sendNote}>
            Send note
          </button>
        </div>
        <div style={dropHintStyle}>You can also drag files into this box.</div>
      </div>
    </aside>
  );
}

const launcherStyle: CSSProperties = {
  position: "fixed",
  right: 132,
  bottom: 18,
  zIndex: 251,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 15px",
  borderRadius: 999,
  border: "1px solid rgba(96,165,250,.55)",
  background: "#18181b",
  color: "#93c5fd",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 35px rgba(0,0,0,.35)",
};

const countStyle: CSSProperties = { minWidth: 20, height: 20, padding: "0 6px", display: "grid", placeItems: "center", borderRadius: 999, background: "#2563eb", color: "white", fontSize: 11 };
const activityDotStyle: CSSProperties = { width: 8, height: 8, borderRadius: 999, background: "#60a5fa", boxShadow: "0 0 0 4px rgba(96,165,250,.16)" };
const panelStyle: CSSProperties = { position: "fixed", zIndex: 540, right: 18, bottom: 18, width: "min(430px, calc(100vw - 36px))", height: "min(760px, calc(100vh - 36px))", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fafafa", background: "#09090b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 18, boxShadow: "0 30px 100px rgba(0,0,0,.65)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 17px", borderBottom: "1px solid rgba(255,255,255,.09)" };
const eyebrowStyle: CSSProperties = { marginBottom: 3, fontSize: 10, letterSpacing: ".13em", textTransform: "uppercase", opacity: .55 };
const batchProgressStyle: CSSProperties = { padding: "11px 15px", borderBottom: "1px solid rgba(96,165,250,.2)", background: "rgba(59,130,246,.09)" };
const progressHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 11, color: "#dbeafe" };
const progressTrackStyle: CSSProperties = { height: 7, marginTop: 7, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.1)" };
const progressFillStyle: CSSProperties = { height: "100%", borderRadius: 999, background: "#3b82f6", transition: "width .25s ease" };
const progressMetaStyle: CSSProperties = { marginTop: 5, fontSize: 10, color: "#93c5fd" };
const messagesStyle: CSSProperties = { flex: 1, overflowY: "auto", padding: 15, display: "flex", flexDirection: "column", gap: 12 };
const assistantBubbleStyle: CSSProperties = { alignSelf: "flex-start", maxWidth: "91%", padding: "11px 13px", borderRadius: "14px 14px 14px 4px", background: "rgba(59,130,246,.14)", border: "1px solid rgba(96,165,250,.22)", color: "#dbeafe", lineHeight: 1.45, fontSize: 13 };
const userBubbleStyle: CSSProperties = { alignSelf: "flex-end", width: "94%", padding: 11, borderRadius: "14px 14px 4px 14px", background: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.1)" };
const emptyStyle: CSSProperties = { margin: "auto", opacity: .45, fontSize: 13, textAlign: "center" };
const assetHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 };
const tagStyle: CSSProperties = { padding: "4px 7px", borderRadius: 999, background: "rgba(96,165,250,.14)", color: "#bfdbfe", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" };
const removeStyle: CSSProperties = { border: 0, background: "transparent", color: "#a1a1aa", cursor: "pointer", fontSize: 19, lineHeight: 1 };
const imageStyle: CSSProperties = { width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, background: "#000" };
const videoStyle: CSSProperties = { width: "100%", maxHeight: 260, borderRadius: 10, background: "#000" };
const noteStyle: CSSProperties = { marginTop: 6, opacity: .78, lineHeight: 1.4, fontSize: 13, whiteSpace: "pre-wrap" };
const itemProgressStyle: CSSProperties = { marginTop: 10, padding: "8px 9px", borderRadius: 9, background: "rgba(255,255,255,.035)" };
const warningStyle: CSSProperties = { marginTop: 8, padding: 8, borderRadius: 8, color: "#fde68a", background: "rgba(245,158,11,.1)", fontSize: 12 };
const errorStyle: CSSProperties = { marginTop: 8, padding: 8, borderRadius: 8, color: "#fecaca", background: "rgba(239,68,68,.11)", border: "1px solid rgba(239,68,68,.22)", fontSize: 12, lineHeight: 1.4 };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 };
const composerStyle: CSSProperties = { padding: 14, borderTop: "1px solid rgba(255,255,255,.09)", background: "rgba(255,255,255,.025)" };
const labelStyle: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 10, marginBottom: 9, color: "#a1a1aa", fontSize: 11 };
const selectStyle: CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 9, border: "1px solid rgba(255,255,255,.12)", background: "#18181b", color: "#fafafa" };
const textareaStyle: CSSProperties = { width: "100%", minHeight: 78, resize: "vertical", padding: "10px 11px", borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "#18181b", color: "#fafafa", lineHeight: 1.4 };
const composerActionsStyle: CSSProperties = { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 10 };
const uploadingStyle: CSSProperties = { marginTop: 9, color: "#fcd34d", fontSize: 12 };
const dropHintStyle: CSSProperties = { marginTop: 8, color: "#71717a", fontSize: 10 };
