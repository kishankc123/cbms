import Link from "next/link";

// Shown on Assets pages whose screens are built in a later step, so a visible menu item never opens a blank page.
export function NextStepNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{title}</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
      <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-primary)]">This screen is being built in the next step.</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          The foundation is ready: set up your asset categories, locations and default accounts in{" "}
          <Link href="/assets/setup" className="text-[var(--color-primary)] hover:underline">
            Setup
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
