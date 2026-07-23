import { create } from "zustand";

export type ToastType = "info" | "success" | "error" | "warning";

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
};

type ToastStore = {
  toasts: Toast[];
  add: (type: ToastType, message: string, durationMs?: number) => void;
  dismiss: (id: string) => void;
};

const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 4000,
  success: 3000,
  error: 6000,
  warning: 5000,
};

export const useToasts = create<ToastStore>()((set) => ({
  toasts: [],
  add: (type, message, durationMs) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message, createdAt: Date.now() }] }));
    const ms = durationMs ?? DEFAULT_DURATION[type];
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (msg: string, ms?: number) => useToasts.getState().add("info", msg, ms),
  success: (msg: string, ms?: number) => useToasts.getState().add("success", msg, ms),
  error: (msg: string, ms?: number) => useToasts.getState().add("error", msg, ms),
  warning: (msg: string, ms?: number) => useToasts.getState().add("warning", msg, ms),
};
