"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

// Toasts: short confirmations that need no answer ("Payment recorded"). Anything the person must read or decide on still
// uses the problem dialog or useConfirm. A toast leaves by itself after a few seconds, or when closed.
//
//   const toast = useToast();
//   toast.success("Payment recorded");

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; message: string };
type Api = Record<Tone, (message: string) => void>;

const ToastContext = createContext<Api | null>(null);

export function useToast(): Api {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs the ToastProvider above it.");
  return api;
}

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const TONE: Record<Tone, string> = { success: "text-[var(--success)]", error: "text-[var(--danger)]", info: "text-accent-text" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((tone: Tone) => (message: string) => setItems((l) => [...l.slice(-3), { id: next.current++, tone, message }]), []);
  const api = useMemo<Api>(() => ({ success: push("success"), error: push("error"), info: push("info") }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.tone === "error" ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  const Icon = ICON[toast.tone];
  return (
    <div role="status" className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] text-ink shadow-[var(--shadow-popover)]">
      <Icon size={16} className={`mt-0.5 shrink-0 ${TONE[toast.tone]}`} />
      <p className="min-w-0 flex-1">{toast.message}</p>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 text-ink-2 transition-colors hover:text-ink">
        <X size={14} />
      </button>
    </div>
  );
}
