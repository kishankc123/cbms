import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { listMembers } from "./actions";
import { UsersManager } from "./users-manager";

export default async function UsersPage() {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) {
    return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage users.</p>;
  }
  const data = await listMembers();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Users</h1>
        <p className="mt-0.5 text-sm text-gray-500">People who can access this organization and the role each one has here.</p>
      </div>
      <UsersManager data={data} />
    </div>
  );
}
