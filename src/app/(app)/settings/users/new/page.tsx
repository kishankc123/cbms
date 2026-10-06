import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { SettingsHeader } from "../../ui";
import { getAddUserData } from "../actions";
import { UserTabs } from "../user-tabs";
import { AddUserForm } from "./add-user-form";

export default async function AddUserPage() {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage users.</p>;
  const data = await getAddUserData();
  return (
    <div className="space-y-5">
      <SettingsHeader title="Add user" description="Add someone who already has a Client Books account, by their email address." />
      <UserTabs active="new" />
      <AddUserForm data={data} />
    </div>
  );
}
