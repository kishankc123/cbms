import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserSession } from "@/lib/session";
import { listActiveMemberships } from "@/lib/memberships";
import { switchOrganization } from "./actions";
import { SignOutLink } from "./sign-out-link";
import { VerifyEmailNotice } from "./verify-email-notice";
import { verificationEmailProblem } from "@/lib/email-log";
import { AddNoticeBanner } from "@/components/add-notice-banner";
import { listAddNotices } from "@/lib/org-members";

export default async function SelectOrganizationPage() {
  // A token that no longer matches the account (disabled, password reset, old
  // format) must end the session rather than show an error.
  const user = await requireUserSession().catch(() => null);
  if (!user) redirect("/signed-out");
  const [orgs, notices] = await Promise.all([listActiveMemberships(user.id), listAddNotices(user.id)]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Select an Organization</h1>
          <p className="text-sm text-gray-500">Signed in as {user.email}</p>
        </div>

        <AddNoticeBanner notices={notices} activeTenantId={null} />
        {!user.emailVerifiedAt && <VerifyEmailNotice emailProblem={await verificationEmailProblem(user.email)} />}

        {orgs.length === 0 ? (
          <div className="space-y-3 text-sm text-gray-600">
            <p className="font-medium text-gray-900">You aren&apos;t part of any organization yet.</p>
            <p>
              Ask an administrator of your organization to add you using <span className="font-medium text-gray-900">{user.email}</span>. {user.emailVerifiedAt ? "They can add you straight away." : "They can add you once your email is verified."} The organization then appears here.
            </p>
            <p>Running a business of your own? You can set one up yourself.</p>
          </div>
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
                    Role: {o.roleName}
                    {o.clientCode ? ` · ${o.clientCode}` : ""}
                  </p>
                </button>
              </form>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <Link href="/create-organization" className="text-[var(--color-primary)] hover:underline">
            {orgs.length === 0 ? "Create a business account" : "+ Create another business"}
          </Link>
          <SignOutLink />
        </div>

        {user.isPlatformAdmin && (
          <div className="border-t border-gray-100 pt-4">
            <Link href="/admin" className="block rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-100">
              Platform Administration →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
