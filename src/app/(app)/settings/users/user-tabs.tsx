import Link from "next/link";

// "User list | Add new" — the two internal screens of Users.
export function UserTabs({ active }: { active: "list" | "new" | "edit" }) {
  const tab = (on: boolean) => `rounded-full px-4 py-1.5 text-sm transition-colors ${on ? "bg-[var(--card-bg)] font-medium text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`;
  return (
    <div className="inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
      <Link href="/settings/users" className={tab(active === "list" || active === "edit")}>
        User list
      </Link>
      <Link href="/settings/users/new" className={tab(active === "new")}>
        Add new
      </Link>
    </div>
  );
}
