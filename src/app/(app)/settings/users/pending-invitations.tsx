"use client";

import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { revokeInvitation, type UsersPage } from "./actions";

export function PendingInvitations({ pending }: { pending: UsersPage["pending"] }) {
  const router = useRouter();
  const { reportError, dialog } = useProblem();

  async function revoke(id: string) {
    try {
      await revokeInvitation(id);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Pending invitations</h2>
      <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <tbody>
            {pending.map((p) => (
              <tr key={p.id} className="border-t border-[var(--card-border)] first:border-t-0">
                <td className="px-4 py-2">{p.email}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{p.roleName}</td>
                <td className="px-4 py-2">{p.expired ? <StatusPill tone="critical">Expired</StatusPill> : <StatusPill tone="pending">Pending</StatusPill>}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => revoke(p.id)} className="text-sm text-red-600 hover:underline">
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}
