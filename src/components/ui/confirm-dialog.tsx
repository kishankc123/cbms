"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "./button";

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
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={() => onAnswer(false)} />
      <div role="alertdialog" aria-modal="true" aria-label={title ?? "Please confirm"} className="relative w-full max-w-sm space-y-4 rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)]">
        {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
        <p className="whitespace-pre-line text-[13px] text-ink">{pending.message}</p>
        <div className="flex justify-end gap-2">
          {cancelLabel && (
            <Button ref={cancelRef} variant="secondary" onClick={() => onAnswer(false)}>
              {cancelLabel}
            </Button>
          )}
          <Button variant={danger ? "danger" : "primary"} onClick={() => onAnswer(true)}>
            {confirmLabel}
          </Button>
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
