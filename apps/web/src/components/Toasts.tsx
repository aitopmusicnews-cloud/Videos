import React from "react";
import { useToasts, type Toast } from "../lib/toast.js";


export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  if (!toasts.length) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className={`toast toast-${toast.type}`} onClick={onDismiss}>
      <span className="toast-icon">{icon(toast.type)}</span>
      <span className="toast-msg">{toast.message}</span>
      <button type="button" className="toast-close">×</button>
    </div>
  );
}

function icon(type: Toast["type"]): string {
  switch (type) {
    case "success": return "✓";
    case "error": return "✕";
    case "warning": return "!";
    case "info": return "i";
  }
}
