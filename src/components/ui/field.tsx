import { forwardRef } from "react";

// Form controls. Compact (32px), a quiet border, an indigo focus ring, and the same look in every module. A control is
// marked invalid with `invalid`, which turns its border red; the reason is shown through Field's `error`.

export const controlClass =
  "h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3";
const invalidClass = "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]";

type Invalid = { invalid?: boolean };
// Full width unless the caller sets a width of its own.
const cx = (invalid: boolean | undefined, className?: string) => `${controlClass} ${/(^|[ ])(w-|max-w-)/.test(className ?? "") ? "" : "w-full"} ${invalid ? invalidClass : ""} ${className ?? ""}`.trim();

export const Input = forwardRef<HTMLInputElement, React.ComponentProps<"input"> & Invalid>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(invalid, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.ComponentProps<"select"> & Invalid>(function Select({ invalid, className, ...rest }, ref) {
  return <select ref={ref} aria-invalid={invalid || undefined} className={cx(invalid, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea"> & Invalid>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} rows={3} className={`${cx(invalid, className)} h-auto py-1.5`} {...rest} />;
});

/** A label above a control, with an optional hint underneath and an error that replaces it. */
export function Field({ label, hint, error, required, htmlFor, className, children }: { label: string; hint?: string; error?: string | null; required?: boolean; htmlFor?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-[var(--danger-text)]">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
