import { useState, useCallback, type DragEvent, type ChangeEvent, type ReactNode } from "react";
import { uploadImage } from "../lib/api.js";
import { getErrorMessage } from "@mvs/shared";

type Props = {
  onUploaded: (url: string) => void;
  className: string;
  children: ReactNode;
  disabled?: boolean;
  /** Called with a status string when uploading. */
  onStatus?: (status: string | null) => void;
};

const isImageFile = (file: File): boolean => {
  if (file.type && file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tiff", "jfif"].includes(ext);
};

/** A click-or-drop image uploader. Wraps `children` in a label so anything
 * inside is the drop target and click target. */
export function AssetUploader({ onUploaded, className, children, disabled, onStatus }: Props) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!isImageFile(file)) {
        onStatus?.(`not an image: ${file.type || "unknown"}`);
        setTimeout(() => onStatus?.(null), 2500);
        return;
      }
      setBusy(true);
      onStatus?.("uploading…");
      try {
        const { url } = await uploadImage(file);
        onUploaded(url);
        onStatus?.(null);
      } catch (err) {
        onStatus?.(`upload failed: ${getErrorMessage(err)}`);
        setTimeout(() => onStatus?.(null), 2500);
      } finally {
        setBusy(false);
      }
    },
    [onUploaded, onStatus]
  );

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  return (
    <label
      className={`${className}${over ? " over" : ""}${busy ? " busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input type="file" accept="image/*" hidden onChange={onPick} disabled={disabled} />
      {children}
    </label>
  );
}
