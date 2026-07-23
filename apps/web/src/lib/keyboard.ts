import { useEffect } from "react";

type Shortcut = {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
};

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Always allow Esc through, even from inputs (closes the sidebar).
      if (e.key !== "Escape" && isEditable(e.target)) return;
      for (const s of shortcuts) {
        if (e.key !== s.key) continue;
        if (s.meta !== undefined && e.metaKey !== s.meta) continue;
        if (s.shift !== undefined && e.shiftKey !== s.shift) continue;
        if (s.alt !== undefined && e.altKey !== s.alt) continue;
        e.preventDefault();
        s.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}
