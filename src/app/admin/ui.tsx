import type { ReactNode } from "react";

// Shared look for the platform administration screens (design tokens, same as the rest of the app).
export const adminCard = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
export const adminField = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";

export function AdminHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{title}</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
      {children}
    </div>
  );
}

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-[var(--text-secondary)]">{k}</dt>
          <dd className="mt-0.5 text-sm text-[var(--text-primary)]">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
