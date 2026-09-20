import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserSession } from "@/lib/session";
import { listActiveMemberships } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";
import { switchOrganization } from "./actions";
import { SignOutLink } from "./sign-out-link";

export default async function SelectOrganizationPage() {
  // A token that no longer matches the account (disabled, password reset, old
  // format) must end the session rather than show an error.
  const user = await requireUserSession().catch(() => null);
  if (!user) redirect("/signed-out");
  const orgs = await listActiveMemberships(user.id);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Select an Organization</h1>
          <p className="text-sm text-gray-500">Signed in as {user.email}</p>
        </div>

        {orgs.length === 0 ? (
          <p className="text-sm text-gray-600">
            You don&apos;t belong to any organization yet. Create one, or ask an administrator to invite you.
          </p>
        ) : (
          <div className="space-y-2">
            {orgs.map((o) => (
              <form key={o.tenantId} action={switchOrganization.bind(null, o.tenantId)}>
                <button
                  type="submit"
                  className="w-full text-left rounded-lg border border-gray-200 hover:border-[var(--color-primary)] hover:bg-gray-50 px-4 py-3"
                >
                  <p className="text-sm font-medium text-gray-900">{o.companyName}</p>
                  <p className="text-xs text-gray-500">
                    Role: {roleLabel(o.role)}
                    {o.clientCode ? ` · ${o.clientCode}` : ""}
                  </p>
                </button>
              </form>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <Link href="/create-organization" className="text-[var(--color-primary)] hover:underline">
            + Create new organization
          </Link>
          <SignOutLink />
        </div>
      </div>
    </div>
  );
}
