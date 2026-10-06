import type { ReactNode } from "react";

// Shared look of the Settings screens (design tokens, same as the rest of the app).
export const settingsInput = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
export const settingsLabel = "mb-1 block text-xs text-gray-500";
export const settingsCard = "max-w-lg space-y-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5";
export const settingsButton = "rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]";

export function SettingsHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
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

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-[var(--text-primary)]">{title}</h2>
      {children}
    </section>
  );
}

/** Tells someone who may look at settings but not change them why the forms are greyed out. */
export function ReadOnlyNotice({ canEdit }: { canEdit: boolean }) {
  return canEdit ? null : <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">You can view these settings but not change them.</p>;
}
