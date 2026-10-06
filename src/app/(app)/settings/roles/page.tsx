import { isOrgAdmin } from "@/lib/roles";
import { requireTenantSession } from "@/lib/session";
import { SettingsHeader } from "../ui";

export default async function RolesPage() {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage roles.</p>;
  return (
    <div className="space-y-6">
      <SettingsHeader title="Roles" description="What each role can see and do in every module." />
      <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-primary)]">Custom roles are being built in the next step.</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Until then every user has one of the four standard roles (Owner, Administrator, Accountant, Staff), assigned under Users.</p>
      </div>
    </div>
  );
}
