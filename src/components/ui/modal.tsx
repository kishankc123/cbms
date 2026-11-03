"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// The one dialog frame: a dimmed backdrop, a panel with a title bar, a scrolling body and an optional footer for the actions.
// Escape or a click on the backdrop closes it. The wrapper keeps the "fixed inset-0" classes because the form helpers that
// move the cursor after an error message (problem-dialog.tsx) look for fields inside it.

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" } as const;

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** The action buttons, right-aligned along the bottom. */
  footer?: React.ReactNode;
  size?: keyof typeof SIZES;
  /** False while something is saving: Escape and the backdrop then do nothing. */
  dismissible?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissible && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissible]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={() => dismissible && onClose()} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`relative flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-[var(--radius-modal)] border border-line bg-surface shadow-[var(--shadow-modal)] outline-none ${SIZES[size]}`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-2">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
