import Link from "next/link";

// "User list | Add new" — the two internal screens of Users.
export function UserTabs({ active }: { active: "list" | "new" | "edit" }) {
  const tab = (on: boolean) => `relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${on ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      <Link href="/settings/users" className={tab(active === "list" || active === "edit")}>
        User list
      </Link>
      <Link href="/settings/users/new" className={tab(active === "new")}>
        Add new
      </Link>
    </div>
  );
}
