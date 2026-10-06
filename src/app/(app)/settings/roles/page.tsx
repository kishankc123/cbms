import { isOrgAdmin } from "@/lib/roles";
import { requireTenantSession } from "@/lib/session";
import { SettingsHeader } from "../ui";
import { getRolesList } from "./actions";
import { RoleTabs } from "./role-tabs";
import { RolesTable } from "./roles-table";

export default async function RolesPage() {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage roles.</p>;
  const roles = await getRolesList();
  return (
    <div className="space-y-5">
      <SettingsHeader title="Roles" description="What each role can see and do in every module. Assign roles to people under Users." />
      <RoleTabs active="list" />
      <RolesTable roles={roles} />
    </div>
  );
}
