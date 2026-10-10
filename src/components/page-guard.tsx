import { can, requireTenantSession } from "@/lib/session";

/** What a person sees on a page their role doesn't include. */
export function NoAccess() {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
      <p className="text-sm font-medium text-[var(--text-primary)]">You don&apos;t have access to this page.</p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Ask an administrator to change your role if you need it.</p>
    </div>
  );
}

/** What a person sees on a salary page when their role does not include seeing salary amounts. */
export function NoSalaryAccess() {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
      <p className="text-sm font-medium text-[var(--text-primary)]">Your role doesn&apos;t include seeing salary amounts.</p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Ask an administrator to give your role &quot;See salary amounts&quot; under Payroll if you need this page.</p>
    </div>
  );
}

/**
 * For a page made of salary figures (salary sheets, payroll setup): returns the "no salary access" screen unless the person's role
 * has Payroll View and "See salary amounts". Like guardView it must run before the page reads any data.
 */
export async function guardSalary() {
  const session = await requireTenantSession();
  return can(session, "payroll", "view") && can(session, "payroll", "view_salary") ? null : <NoSalaryAccess />;
}

/**
 * The first line of a page: returns the "no access" screen (to be returned from the page) unless the person may view
 * at least one of the modules. It must run before the page reads any data. Layouts can't do this job: they don't run
 * again on client-side navigation, and they don't stop the page underneath from rendering.
 */
export async function guardView(...modules: string[]) {
  const session = await requireTenantSession();
  return modules.some((m) => can(session, m, "view")) ? null : <NoAccess />;
}
