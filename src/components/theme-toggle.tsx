"use client";

import { useState, useTransition } from "react";
import { setTheme } from "@/app/theme-actions";
import type { Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light theme",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark theme",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Match system",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 20h8M12 17v3" />
      </svg>
    ),
  },
];

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setLocalTheme] = useState<Theme>(initial);
  const [, startTransition] = useTransition();

  function pick(value: Theme) {
    setLocalTheme(value);
    if (value === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", value);
    }
    startTransition(() => {
      setTheme(value);
    });
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-[var(--sidebar-bg-hover)] p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-label={opt.label}
          aria-pressed={theme === opt.value}
          onClick={() => pick(opt.value)}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            theme === opt.value ? "bg-[var(--sidebar-text-active)] text-[var(--sidebar-bg)]" : "text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)]"
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
