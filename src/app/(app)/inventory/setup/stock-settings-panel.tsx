"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateInventorySettings } from "./actions";
import { useProblem } from "@/components/problem-dialog";

export function StockSettingsPanel({ allowNegativeStock }: { allowNegativeStock: boolean }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [allow, setAllow] = useState(allowNegativeStock);
  const [saving, setSaving] = useState(false);

  async function save(next: boolean) {
    setSaving(true);
    try {
      await updateInventorySettings({ allowNegativeStock: next });
      setAllow(next);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={allow} disabled={saving} onChange={(e) => save(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-medium text-gray-900">Allow selling more than is in stock</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            When off (recommended), a sale that would take an item below zero is refused, naming the item. When on, the sale goes through and the item shows
            negative stock until it is purchased; goods beyond what was on hand are costed at the item&apos;s average cost (its standard purchase price if none is on hand).
          </span>
        </span>
      </label>
      {dialog}
    </div>
  );
}
