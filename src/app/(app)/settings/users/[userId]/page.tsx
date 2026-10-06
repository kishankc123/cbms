import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { SettingsHeader } from "../../ui";
import { getMemberForEdit } from "../actions";
import { UserTabs } from "../user-tabs";
import { EditUserForm } from "./edit-user-form";

export default async function EditUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage users.</p>;
  const { userId } = await params;
  const data = await getMemberForEdit(userId);
  if (!data) return <p className="text-sm text-gray-500">User not found.</p>;
  return (
    <div className="space-y-5">
      <SettingsHeader title={data.member.name} description={`${data.member.code} · ${data.member.email}`} />
      <UserTabs active="edit" />
      <EditUserForm key={userId} data={data} />
    </div>
  );
}
