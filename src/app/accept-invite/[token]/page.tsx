import Link from "next/link";
import { auth } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { loadInvitation, invitationHasAccount } from "@/lib/invitations";
import { AcceptExisting, AcceptNew } from "./accept-forms";

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await loadInvitation(token);
  const session = await auth();

  let body: React.ReactNode;
  if (!invite) {
    body = <p className="text-sm text-red-600">This invitation is invalid, has expired, or was revoked.</p>;
  } else {
    const hasAccount = await invitationHasAccount(invite.email);
    const signedInAsInvitee = session?.user?.email?.toLowerCase() === invite.email.toLowerCase();

    body = (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          You&apos;ve been invited to join <span className="font-medium text-gray-900">{invite.orgName}</span> as{" "}
          <span className="font-medium text-gray-900">{roleLabel(invite.role)}</span>.
        </p>
        <p className="text-xs text-gray-500">Invitation for {invite.email}</p>

        {!hasAccount ? (
          <AcceptNew token={token} />
        ) : signedInAsInvitee ? (
          <AcceptExisting token={token} />
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-gray-600">This email already has an account. Sign in with it to accept — your existing password works for every organization.</p>
            <Link href={`/login?callbackUrl=/accept-invite/${token}`} className="block text-center bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium">
              Sign in to accept
            </Link>
            {session?.user && <p className="text-xs text-gray-500">You are currently signed in as {session.user.email}. Sign out first to use {invite.email}.</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-8 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Organization invitation</h1>
        {body}
      </div>
    </div>
  );
}
