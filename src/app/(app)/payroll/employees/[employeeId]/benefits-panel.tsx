"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deactivateBenefit } from "../actions";
import { AddBenefitModal } from "./add-benefit-modal";

type Benefit = {
  id: string;
  benefitType: string;
  amount: string;
  frequency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  eligibilityStatus: string;
  notes: string | null;
};

export function BenefitsPanel({ employeeId, benefits }: { employeeId: string; benefits: Benefit[] }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);

  async function handleDeactivate(id: string) {
    if (!confirm("End this benefit as of today?")) return;
    await deactivateBenefit({ benefitId: id });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + Add Benefit
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">Benefit Type</th>
            <th className="px-3 py-2 font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Frequency</th>
            <th className="px-3 py-2 font-medium">Effective From</th>
            <th className="px-3 py-2 font-medium">Effective To</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Notes</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {benefits.map((b) => (
            <tr key={b.id} className="border-t border-gray-100">
              <td className="px-3 py-2">{b.benefitType}</td>
              <td className="px-3 py-2">{Number(b.amount).toFixed(2)}</td>
              <td className="px-3 py-2 capitalize">{b.frequency.replace("_", " ")}</td>
              <td className="px-3 py-2">{b.effectiveFrom}</td>
              <td className="px-3 py-2">{b.effectiveTo ?? "Ongoing"}</td>
              <td className="px-3 py-2 capitalize">{b.eligibilityStatus}</td>
              <td className="px-3 py-2">{b.notes ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                {b.eligibilityStatus === "active" && !b.effectiveTo && (
                  <button type="button" onClick={() => handleDeactivate(b.id)} className="text-xs text-red-600 hover:underline">
                    End
                  </button>
                )}
              </td>
            </tr>
          ))}
          {benefits.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                No benefits yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showAdd && <AddBenefitModal employeeId={employeeId} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
