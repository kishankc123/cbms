import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { getAdminUser } from "../../actions";
import { AdminHeader } from "../../ui";
import { UserDetail } from "./user-detail";

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  await requirePlatformAdmin();
  const { userId } = await params;
  const data = await getAdminUser(userId);
  return (
    <div className="space-y-5 p-8">
      <Link href="/admin/users" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        ← All users
      </Link>
      {data ? (
        <>
          <AdminHeader title={data.user.name} description={data.user.email} />
          <UserDetail data={data} />
        </>
      ) : (
        <p className="text-sm text-gray-500">User not found.</p>
      )}
    </div>
  );
}
