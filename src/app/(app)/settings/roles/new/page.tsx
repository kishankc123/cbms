import { isOrgAdmin } from "@/lib/roles";
import { requireTenantSession } from "@/lib/session";
import { SettingsHeader } from "../../ui";
import { getRoleEditor } from "../actions";
import { RoleForm } from "../role-form";
import { RoleTabs } from "../role-tabs";

export default async function NewRolePage({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage roles.</p>;
  const { copy } = await searchParams;
  const editor = await getRoleEditor(null, copy ?? null);
  return (
    <div className="space-y-5">
      <SettingsHeader title="Add role" description="Name the role and choose what it can do in each module." />
      <RoleTabs active="new" />
      {editor && <RoleForm editor={editor} />}
    </div>
  );
}
