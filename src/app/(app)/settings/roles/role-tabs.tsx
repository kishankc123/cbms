import Link from "next/link";

// "Role list | Add new" — the two internal screens of Roles.
export function RoleTabs({ active }: { active: "list" | "new" | "edit" }) {
  const tab = (on: boolean) => `rounded-full px-4 py-1.5 text-sm transition-colors ${on ? "bg-[var(--card-bg)] font-medium text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`;
  return (
    <div className="inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
      <Link href="/settings/roles" className={tab(active === "list" || active === "edit")}>
        Role list
      </Link>
      <Link href="/settings/roles/new" className={tab(active === "new")}>
        Add new
      </Link>
    </div>
  );
}
