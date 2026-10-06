import { requirePlatformAdmin } from "@/lib/session";
import { getAdminUsers } from "../actions";
import { AdminHeader } from "../ui";
import { UsersTable } from "./users-table";

type Search = { q?: string; status?: string; admins?: string; page?: string; size?: string };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const data = await getAdminUsers({ search: sp.q, status: sp.status, admins: sp.admins === "1", page: Number(sp.page) || 1, pageSize: Number(sp.size) || 25 });
  return (
    <div className="space-y-5 p-8">
      <AdminHeader title="Users" description="Every account registered on the platform, across all organizations." />
      <UsersTable data={data} filters={{ q: sp.q ?? "", status: sp.status ?? "", admins: sp.admins === "1" }} />
    </div>
  );
}
