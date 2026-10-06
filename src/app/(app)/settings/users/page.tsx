import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { SettingsHeader } from "../ui";
import { getUsersPage } from "./actions";
import { PendingInvitations } from "./pending-invitations";
import { UserTabs } from "./user-tabs";
import { UsersList } from "./users-list";

type Search = { q?: string; status?: string; role?: string; page?: string; size?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) {
    return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage users.</p>;
  }
  const sp = await searchParams;
  const data = await getUsersPage({ search: sp.q, status: sp.status, roleId: sp.role, page: Number(sp.page) || 1, pageSize: Number(sp.size) || 25 });

  return (
    <div className="space-y-5">
      <SettingsHeader title="Users" description="People who can access this organization and the role each one has here." />
      <UserTabs active="list" />
      <UsersList data={data} filters={{ q: sp.q ?? "", status: sp.status ?? "", role: sp.role ?? "" }} />
      {data.pending.length > 0 && <PendingInvitations pending={data.pending} />}
    </div>
  );
}
