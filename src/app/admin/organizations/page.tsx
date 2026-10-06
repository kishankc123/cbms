import { requirePlatformAdmin } from "@/lib/session";
import { getAdminOrgs } from "../actions";
import { AdminHeader } from "../ui";
import { OrgsTable } from "./orgs-table";

type Search = { q?: string; status?: string; page?: string; size?: string };

export default async function AdminOrganizationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const data = await getAdminOrgs({ search: sp.q, status: sp.status, page: Number(sp.page) || 1, pageSize: Number(sp.size) || 25 });
  return (
    <div className="space-y-5 p-8">
      <AdminHeader title="Organizations" description="Every organization on the platform. Suspending one blocks all its members at once." />
      <OrgsTable data={data} filters={{ q: sp.q ?? "", status: sp.status ?? "" }} />
    </div>
  );
}
