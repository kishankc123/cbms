"use client";

import { useCallback, useEffect, useState } from "react";

// Keeps what someone is typing into a long form safe in this browser, so a reload, a lost connection, a redeploy or an accidental
// navigation does not cost them their work. The form's own state stays the source of truth; this only remembers a copy, offers it
// back on the next visit ("Restore" or "Discard"), and forgets it once the work is saved or cleared. Nothing leaves the browser.
// Storage can be unavailable (private windows, blocked site data): every access is guarded and the form works without it.

const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // a draft older than a week is not offered back

type Stored<T> = { v: number; at: string; value: T };

function read<T>(key: string): Stored<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (parsed.v !== VERSION || !parsed.at || Date.now() - new Date(parsed.at).getTime() > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: VERSION, at: new Date().toISOString(), value } satisfies Stored<T>));
  } catch {
    /* storage unavailable or full: the form still works */
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export type Draft<T> = {
  /** A saved copy from an earlier visit, waiting for the person to restore or discard it. */
  pending: { at: string; value: T } | null;
  /** Gives the saved copy back (and stops offering it). */
  restore: () => T | null;
  /** Throws the saved copy away. */
  discard: () => void;
  /** Forgets the saved copy: call it once the work is saved or deliberately cleared. */
  clear: () => void;
};

/**
 * `key` names the draft (include the organization and the person, so two people on one computer never see each other's);
 * `value` is the form's current state; `meaningful` says whether there is anything worth keeping yet. A form with nothing typed leaves
 * an earlier draft alone, and the first real typing replaces it.
 */
export function useDraft<T>(key: string | null, value: T, meaningful: boolean): Draft<T> {
  const [pending, setPending] = useState<{ at: string; value: T } | null>(null);

  // On arrival: is there something left over from before?
  useEffect(() => {
    if (!key) return;
    const found = read<T>(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (found) setPending({ at: found.at, value: found.value });
  }, [key]);

  // While working: keep a copy, a moment after each change.
  useEffect(() => {
    if (!key || !meaningful) return;
    const t = setTimeout(() => {
      write(key, value);
      // New work has started: the old copy is replaced, so stop offering it.
      setPending(null);
    }, 500);
    return () => clearTimeout(t);
  }, [key, value, meaningful]);

  const restore = useCallback(() => {
    const p = pending;
    setPending(null);
    return p ? p.value : null;
  }, [pending]);
  const discard = useCallback(() => {
    if (key) remove(key);
    setPending(null);
  }, [key]);
  const clear = useCallback(() => {
    if (key) remove(key);
    setPending(null);
  }, [key]);

  return { pending, restore, discard, clear };
}

/** The line shown above a form when a saved copy is waiting. */
export function DraftBanner({ draft, what, summary, onRestore }: { draft: Draft<unknown>; what: string; summary?: string; onRestore: () => void }) {
  if (!draft.pending) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
      <span>
        You have {what} you hadn&apos;t saved, from {new Date(draft.pending.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        {summary ? ` (${summary})` : ""}. Starting something new replaces it.
      </span>
      <span className="flex gap-2">
        <button type="button" onClick={onRestore} className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white">
          Restore
        </button>
        <button type="button" onClick={draft.discard} className="rounded border border-amber-400 bg-white px-3 py-1 text-sm text-amber-900">
          Discard
        </button>
      </span>
    </div>
  );
}
