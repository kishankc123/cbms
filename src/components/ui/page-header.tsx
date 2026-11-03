import Link from "next/link";
import { BackButton } from "./back-button";

/**
 * The top of every page: the title, a short description only where it helps, a back button or breadcrumbs for deeper pages,
 * and the page's actions on the right: secondary actions first, then the one primary action.
 */
export function PageHeader({
  title,
  description,
  back,
  breadcrumbs,
  actions,
  primary,
  className = "",
}: {
  title: string;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  breadcrumbs?: { label: string; href?: string }[];
  /** Secondary actions (export, import, filters...). */
  actions?: React.ReactNode;
  /** The page's one main action. */
  primary?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        {back && <BackButton href={back.href} label={back.label} className="mt-0.5" />}
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-2">
              {breadcrumbs.map((b, i) => (
                <span key={`${b.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden className="text-ink-2">/</span>}
                  {b.href ? (
                    <Link href={b.href} className="hover:text-ink hover:underline">
                      {b.label}
                    </Link>
                  ) : (
                    <span>{b.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
        </div>
      </div>
      {(actions || primary) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {primary}
        </div>
      )}
    </div>
  );
}
