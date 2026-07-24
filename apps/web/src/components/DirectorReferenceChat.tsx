import { useEffect, useRef, useState, type CSSProperties } from "react";
import { extractLastFrame, uploadImage, uploadVideo } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

type ReferenceKind = "character" | "style" | "location" | "shot";
type ReferenceMedia = "image" | "video" | "note";

type ReferenceItem = {
  id: string;
  kind: ReferenceKind | "note";
  media: ReferenceMedia;
  name: string;
  url?: string;
  anchorUrl?: string;
  note?: string;
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

export function DirectorReferenceChat() {
  const songId = useStore((state) => state.songId);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<ReferenceKind>("style");
  const [uploading, setUploading] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!songId) {
      setItems([]);
      setOpen(false);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey(songId));
      setItems(raw ? JSON.parse(raw) as ReferenceItem[] : []);
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

    for (let index = 0; index < accepted.length; index += 1) {
      const file = accepted[index]!;
      setUploading(`Uploading ${index + 1} of ${accepted.length}: ${file.name}`);
      try {
        let item: ReferenceItem;
        if (isImage(file)) {
          const uploaded = await uploadImage(file);
          item = {
            id: `ref-${crypto.randomUUID().slice(0, 8)}`,
            kind,
            media: "image",
            name: file.name,
            url: uploaded.url,
            anchorUrl: uploaded.url,
            note: draft.trim() || undefined,
            createdAt: Date.now(),
          };
        } else {
          const uploaded = await uploadVideo(file);
          let anchorUrl: string | undefined;
          try {
            setUploading(`Extracting reference frame: ${file.name}`);
            anchorUrl = (await extractLastFrame(uploaded.url)).url;
          } catch (error) {
            console.warn("Could not extract reference frame", error);
          }
          item = {
            id: `ref-${crypto.randomUUID().slice(0, 8)}`,
            kind,
            media: "video",
            name: file.name,
            url: uploaded.url,
            anchorUrl,
            note: draft.trim() || undefined,
            createdAt: Date.now(),
          };
        }

        setItems((current) => [...current, item]);
        const anchorUrl = item.anchorUrl ?? (item.media === "image" ? item.url : undefined);
        if (anchorUrl) {
          dispatchReference({
            kind,
            media: item.media,
            name: item.name,
            url: anchorUrl,
            sourceUrl: item.url,
            note: item.note,
          });
        }
        toast.success(`${file.name} added as a ${kind} reference`);
      } catch (error) {
        toast.error(`Reference upload failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    setDraft("");
    setUploading(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  if (!open) {
    return (
      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>
        ＋ References
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

      <div style={messagesStyle}>
        <div style={assistantBubbleStyle}>
          Upload character photos, visual references, locations, wardrobe, shot examples, or videos. Add a note explaining what the Director should borrow from each reference.
        </div>

        {items.length === 0 && (
          <div style={emptyStyle}>No references uploaded for this song yet.</div>
        )}

        {items.map((item) => (
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
            {item.media === "video" && !item.anchorUrl && (
              <div style={warningStyle}>The video uploaded, but its reference frame could not be extracted.</div>
            )}

            {item.media !== "note" && (
              <div style={actionsStyle}>
                <button type="button" className="btn ghost" onClick={() => applyReference(item, "character")}>Use as character</button>
                <button type="button" className="btn ghost" onClick={() => applyReference(item, "style")}>Style</button>
                <button type="button" className="btn ghost" onClick={() => applyReference(item, "location")}>Location</button>
                <button type="button" className="btn ghost" onClick={() => applyReference(item, "shot")}>Shot</button>
              </div>
            )}
          </article>
        ))}
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
const panelStyle: CSSProperties = { position: "fixed", zIndex: 540, right: 18, bottom: 18, width: "min(430px, calc(100vw - 36px))", height: "min(760px, calc(100vh - 36px))", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fafafa", background: "#09090b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 18, boxShadow: "0 30px 100px rgba(0,0,0,.65)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 17px", borderBottom: "1px solid rgba(255,255,255,.09)" };
const eyebrowStyle: CSSProperties = { marginBottom: 3, fontSize: 10, letterSpacing: ".13em", textTransform: "uppercase", opacity: .55 };
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
const warningStyle: CSSProperties = { marginTop: 8, padding: 8, borderRadius: 8, color: "#fde68a", background: "rgba(245,158,11,.1)", fontSize: 12 };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 };
const composerStyle: CSSProperties = { padding: 14, borderTop: "1px solid rgba(255,255,255,.09)", background: "rgba(255,255,255,.025)" };
const labelStyle: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 10, marginBottom: 9, color: "#a1a1aa", fontSize: 11 };
const selectStyle: CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 9, border: "1px solid rgba(255,255,255,.12)", background: "#18181b", color: "#fafafa" };
const textareaStyle: CSSProperties = { width: "100%", minHeight: 78, resize: "vertical", padding: "10px 11px", borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "#18181b", color: "#fafafa", lineHeight: 1.4 };
const composerActionsStyle: CSSProperties = { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 10 };
const uploadingStyle: CSSProperties = { marginTop: 9, color: "#fcd34d", fontSize: 12 };
const dropHintStyle: CSSProperties = { marginTop: 8, color: "#71717a", fontSize: 10 };
