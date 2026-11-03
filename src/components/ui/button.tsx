import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

// The one button. Primary is the single main action of a page or dialog (indigo); Secondary is the usual choice;
// Ghost is for quiet actions inside toolbars and rows; Danger is only for actions that delete or can't be undone.
// Compact by default (32px, or 28px with size="sm"). A link that should look like a button uses buttonClass().

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 disabled:pointer-events-none disabled:opacity-50";
const SIZES: Record<ButtonSize, string> = { md: "h-8 px-3 text-[13px]", sm: "h-7 px-2.5 text-xs" };
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-[var(--on-accent)] hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-hover",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  danger: "bg-[var(--danger-fill)] text-[var(--on-danger)] hover:opacity-90",
};

export function buttonClass({ variant = "secondary", size = "md", className = "" }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`.trim();
}

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button while its action runs. */
  loading?: boolean;
  /** An icon before the label (a Lucide icon at size 14). */
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size, loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass({ variant, size, className })} {...rest}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});
