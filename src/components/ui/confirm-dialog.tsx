"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// The one confirmation pop-up. Ask before anything that deletes, voids, closes, ends or can't easily be undone:
//
//   const ask = useConfirm();
//   if (!(await ask(`Delete ${name}? This cannot be undone.`, { danger: true, confirmLabel: "Delete" }))) return;
//
// Never use the browser's own confirm() — it looks foreign, can't be styled, and is blocked in some browsers.

type Options = { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Ask = (message: string, options?: Options) => Promise<boolean>;
type Pending = { message: string; options: Options; resolve: (yes: boolean) => void };

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm needs the ConfirmProvider above it.");
  return ask;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback<Ask>((message, options = {}) => new Promise((resolve) => setPending({ message, options, resolve })), []);
  const answer = (yes: boolean) => {
    pending?.resolve(yes);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && <Dialog pending={pending} onAnswer={answer} />}
    </ConfirmContext.Provider>
  );
}

function Dialog({ pending, onAnswer }: { pending: Pending; onAnswer: (yes: boolean) => void }) {
  const { title, confirmLabel = "Yes", cancelLabel = "Cancel", danger } = pending.options;
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onAnswer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => onAnswer(false)} />
      <div role="alertdialog" aria-modal="true" aria-label={title ?? "Please confirm"} className="relative w-full max-w-sm space-y-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-lg">
        {title && <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>}
        <p className="whitespace-pre-line text-sm text-[var(--text-primary)]">{pending.message}</p>
        <div className="flex justify-end gap-2">
          {cancelLabel && (
            <button ref={cancelRef} type="button" onClick={() => onAnswer(false)} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
              {cancelLabel}
            </button>
          )}
          <button type="button" onClick={() => onAnswer(true)} className={`rounded px-4 py-1.5 text-sm text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]"}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A form that asks first: it submits (to its `action`) only after the person says yes. */
export function ConfirmForm({ confirm, confirmOptions, onConfirmed, ...form }: React.ComponentProps<"form"> & { confirm: string; confirmOptions?: Options; onConfirmed?: () => void }) {
  const ask = useConfirm();
  const sent = useRef(false);
  return (
    <form
      {...form}
      onSubmit={async (e) => {
        if (sent.current) return void (sent.current = false);
        e.preventDefault();
        const el = e.currentTarget;
        if (!(await ask(confirm, confirmOptions))) return;
        onConfirmed?.();
        sent.current = true;
        el.requestSubmit();
      }}
    />
  );
}
