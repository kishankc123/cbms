"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dismissNotice, leaveOrganizationAction } from "@/app/membership-notice-actions";
import { ConfirmDialog } from "@/app/(app)/sales/confirm-dialog";

export type AddNotice = { membershipId: string; tenantId: string; orgName: string; roleName: string; addedByName: string };

// Shown until dismissed, like the verify-your-email banner: someone added this person to an organization, so they can
// see it, accept it by dismissing, or leave.
export function AddNoticeBanner({ notices, activeTenantId }: { notices: AddNotice[]; activeTenantId: string | null }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<string[]>([]);
  const [leaving, setLeaving] = useState<AddNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = notices.filter((n) => !hidden.includes(n.membershipId));
  if (shown.length === 0) return null;

  async function dismiss(n: AddNotice) {
    setHidden((h) => [...h, n.membershipId]);
    await dismissNotice(n.membershipId);
    router.refresh();
  }

  async function leave() {
    const n = leaving;
    setLeaving(null);
    if (!n) return;
    const r = await leaveOrganizationAction(n.membershipId);
    if (!r.ok) return setError(r.error);
    setHidden((h) => [...h, n.membershipId]);
    // Leaving the organization being worked in ends that session's access, so go back to the picker.
    if (n.tenantId === activeTenantId) router.push("/select-organization");
    else router.refresh();
  }

  return (
    <div className="mb-4 space-y-2">
      {shown.map((n) => (
        <div key={n.membershipId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          <span>
            {n.addedByName} added you to <b>{n.orgName}</b> as {n.roleName}.
          </span>
          <span className="flex items-center gap-4">
            <button type="button" onClick={() => dismiss(n)} className="font-medium underline">
              OK, got it
            </button>
            <button type="button" onClick={() => setLeaving(n)} className="underline">
              Leave organization
            </button>
          </span>
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {leaving && <ConfirmDialog message={`Leave ${leaving.orgName}? You'll lose access to it, and an administrator would have to add you again.`} onYes={leave} onNo={() => setLeaving(null)} />}
    </div>
  );
}
