// The Workdela mark and wordmark, in one place so the logo can be changed without touching any screen.
// `tone="light"` is for light surfaces; `tone="dark"` is for the dark sidebar and the sign-in brand panel.

export const APP_NAME = "Workdela";

const COLORS = {
  light: { first: "#5b5fc7", second: "#1d9e75" },
  dark: { first: "#afa9ec", second: "#5dcaa5" },
} as const;

/** A W made of two interlocking Vs. */
export function LogoMark({ size = 24, tone = "light", className }: { size?: number; tone?: keyof typeof COLORS; className?: string }) {
  const c = COLORS[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" className={className} aria-hidden="true">
      <polyline points="6,14 18,42 30,14" fill="none" stroke={c.first} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="26,14 38,42 50,14" fill="none" stroke={c.second} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

export function Logo({ size = 24, tone = "light", className = "" }: { size?: number; tone?: keyof typeof COLORS; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} tone={tone} />
      <span className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
