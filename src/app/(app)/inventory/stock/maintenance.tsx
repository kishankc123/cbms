"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rebuildInventoryBalances, recalculateInventory } from "./opening-actions";
import { useProblem } from "@/components/problem-dialog";
import { InfoDialog } from "../info-dialog";

// Housekeeping for the stock ledger: re-cost history in date order (safe to run any time), and — only when the stored balances
// have drifted from what the movements add up to — set them back.
export function StockMaintenance({ mismatched }: { mismatched: { name: string; storedQuantity: number; ledgerQuantity: number; storedValue: number; ledgerValue: number }[] }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function recalc() {
    setBusy(true);
    try {
      const r = await recalculateInventory();
      setMessage(r.changes === 0 ? "Every cost already matches the history — nothing to correct." : `${r.changes} cost${r.changes === 1 ? "" : "s"} across ${r.items} item${r.items === 1 ? "" : "s"} corrected.`);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to recalculate", null);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    setBusy(true);
    try {
      const r = await rebuildInventoryBalances();
      setMessage(`${r.fixed} item balance${r.fixed === 1 ? "" : "s"} set back to what the movements add up to.`);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to rebuild", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      {mismatched.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="font-medium">{mismatched.length} item{mismatched.length === 1 ? "" : "s"} where the stored balance differs from the stock movements:</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {mismatched.map((m) => (
              <li key={m.name}>
                {m.name}: stored {m.storedQuantity} / {m.storedValue.toFixed(2)}, movements say {m.ledgerQuantity} / {m.ledgerValue.toFixed(2)}
              </li>
            ))}
          </ul>
          <button type="button" onClick={rebuild} disabled={busy} className="mt-2 rounded border border-amber-300 bg-white px-3 py-1 text-xs hover:bg-amber-100 disabled:opacity-50">
            Set balances from movements
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Costs follow the history in date order. If a document was backdated or something was voided, run this to make sure every cost is right.</p>
        <button type="button" onClick={recalc} disabled={busy} className="ml-4 shrink-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {busy ? "Working..." : "Recalculate costs"}
        </button>
      </div>
      {dialog}
      {message && <InfoDialog message={message} onOk={() => setMessage(null)} />}
    </div>
  );
}
