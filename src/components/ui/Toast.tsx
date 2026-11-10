import { useEffect } from "react";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (tone, message) => set((s) => ({ items: [...s.items, { id: nextId++, tone, message }].slice(-4) })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Imperative API usable from anywhere: toast.success("Saved") */
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
  info: (message: string) => useToastStore.getState().push("info", message),
};

const toneStyles: Record<ToastTone, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: "text-success" },
  error: { icon: AlertTriangle, cls: "text-high" },
  info: { icon: Info, cls: "text-low" },
};

function ToastRow({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const t = window.setTimeout(() => dismiss(item.id), item.tone === "error" ? 7000 : 4000);
    return () => window.clearTimeout(t);
  }, [item.id, item.tone, dismiss]);

  const { icon: Icon, cls } = toneStyles[item.tone];
  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface p-3 pr-2 shadow-pop"
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cls)} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-ink">{item.message}</p>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss notification"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Mount once near the app root. Sits above the mobile tab bar. */
export function Toaster() {
  const items = useToastStore((s) => s.items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-32 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-14 md:right-6 md:items-end md:px-0"
    >
      {items.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </div>
  );
}
