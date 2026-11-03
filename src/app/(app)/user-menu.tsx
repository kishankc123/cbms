"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

/** The person's avatar in the top bar: who is signed in, and Sign out. */
export function UserMenu({ name, email, detail, extra }: { name: string | null; email: string; detail?: string; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = (name || email).trim().slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu" title={name || email} className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-ink ring-1 ring-line transition-colors hover:bg-hover">
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-line bg-surface py-1 text-[13px] shadow-[var(--shadow-popover)]">
          <div className="border-b border-line px-3 py-2">
            {name && <p className="truncate font-medium text-ink">{name}</p>}
            <p className="truncate text-xs text-ink-2">{email}</p>
            {detail && <p className="mt-0.5 truncate text-xs text-ink-2">{detail}</p>}
          </div>
          {extra && <div className="border-b border-line px-3 py-2 sm:hidden">{extra}</div>}
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover">
            <LogOut size={14} className="text-ink-2" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
