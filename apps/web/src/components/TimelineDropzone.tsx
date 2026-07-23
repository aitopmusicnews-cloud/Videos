import { useState, useCallback, type DragEvent, type ChangeEvent } from "react";
import { uploadSong, pollAnalysis } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { getErrorMessage } from "@mvs/shared";

export function TimelineDropzone() {
  const loadSong = useStore((s) => s.loadSong);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        setStatus("uploading…");
        const { id, audioUrl, filename } = await uploadSong(file);
        setStatus("analyzing…");
        const analysis = await pollAnalysis(id);
        loadSong(id, audioUrl, analysis, filename ?? file.name);
        setStatus(null);
      } catch (err) {
        setStatus(`failed: ${getErrorMessage(err)}`);
      }
    },
    [loadSong]
  );

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <section className="timeline-dropzone">
      <label
        className={`inner${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input type="file" accept="audio/*" hidden onChange={onPick} />
        <div className="big">{status ?? "Drop a tune"}</div>
        <div className="sub">or click to choose · mp3, wav, m4a</div>
      </label>
    </section>
  );
}
