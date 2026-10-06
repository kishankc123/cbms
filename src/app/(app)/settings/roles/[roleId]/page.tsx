import { isOrgAdmin } from "@/lib/roles";
import { requireTenantSession } from "@/lib/session";
import { SettingsHeader } from "../../ui";
import { getRoleEditor } from "../actions";
import { RoleForm } from "../role-form";
import { RoleTabs } from "../role-tabs";

export default async function EditRolePage({ params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage roles.</p>;
  const { roleId } = await params;
  const editor = await getRoleEditor(roleId);
  if (!editor?.role) return <p className="text-sm text-gray-500">Role not found.</p>;
  return (
    <div className="space-y-5">
      <SettingsHeader title={editor.role.fixed ? editor.role.name : `Edit ${editor.role.name}`} description="What this role can see and do in every module." />
      <RoleTabs active="edit" />
      <RoleForm key={editor.role.id} editor={editor} />
    </div>
  );
}
