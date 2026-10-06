import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { getAdminOrg } from "../../actions";
import { AdminHeader } from "../../ui";
import { OrgDetail } from "./org-detail";

export default async function AdminOrganizationPage({ params }: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformAdmin();
  const { tenantId } = await params;
  const data = await getAdminOrg(tenantId);
  return (
    <div className="space-y-5 p-8">
      <Link href="/admin/organizations" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        ← All organizations
      </Link>
      {data ? (
        <>
          <AdminHeader title={data.org.name} description={data.org.clientCode ?? "No client code"} />
          <OrgDetail data={data} />
        </>
      ) : (
        <p className="text-sm text-gray-500">Organization not found.</p>
      )}
    </div>
  );
}
