"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { voidInterTransfer } from "../actions";

export function VoidButton({ transferId, transferNumber }: { transferId: string; transferNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVoid() {
    if (!reason.trim()) return setError("A void reason is required.");
    setBusy(true);
    setError(null);
    try {
      await voidInterTransfer(transferId, reason);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to void transfer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-red-300 text-red-600 hover:bg-red-50 text-sm px-4 py-1.5">
        Void
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Void transfer {transferNumber}</h3>
            <p className="text-xs text-gray-500">The money is moved back and the accounting entry is reversed.</p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="button" onClick={handleVoid} disabled={busy} className="rounded bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-1.5 disabled:opacity-50">
                {busy ? "Voiding..." : "Void Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
