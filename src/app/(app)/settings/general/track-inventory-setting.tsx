"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { useToast } from "@/components/ui/toast";
import { updateTrackInventory } from "../actions";
import { settingsCard } from "../ui";

// One switch for the whole organization: does it keep stock and work out cost of goods sold, or just record purchase bill amounts?
export function TrackInventorySetting({ track, canEdit }: { track: boolean; canEdit: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [value, setValue] = useState(track);
  const [busy, setBusy] = useState(false);

  async function choose(next: boolean) {
    if (next === value || busy) return;
    const message = next
      ? "Start keeping stock? New purchases will be entered with the items bought, stock and cost of goods sold will be worked out from your opening stock date. Purchases already recorded by amount stay as expenses."
      : "Stop keeping stock? New purchases will be entered by bill amount only, with no items, and cost of goods sold will no longer be worked out for them. Stock already in your books stays as it is, and nothing already recorded changes.";
    if (!(await ask(message, { confirmLabel: next ? "Keep stock" : "Record amounts only" }))) return;
    setBusy(true);
    try {
      await updateTrackInventory({ track: next });
      setValue(next);
      toast.success(next ? "Inventory tracking is on" : "Purchases will be recorded by amount only");
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the setting", null);
    } finally {
      setBusy(false);
    }
  }

  const option = (next: boolean, title: string, text: string) => (
    <label className={`flex items-start gap-3 rounded border p-3 text-sm ${value === next ? "border-[var(--color-primary)] bg-[var(--surface-muted-bg)]" : "border-[var(--card-border)]"} ${canEdit ? "cursor-pointer" : "opacity-70"}`}>
      <input type="radio" name="trackInventory" checked={value === next} disabled={!canEdit || busy} onChange={() => choose(next)} className="mt-1" />
      <span>
        <span className="block font-medium text-[var(--text-primary)]">{title}</span>
        <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{text}</span>
      </span>
    </label>
  );

  return (
    <div className={`${settingsCard} !max-w-2xl`}>
      <p className="text-sm text-[var(--text-secondary)]">How this organization records what it buys.</p>
      <div className="space-y-2">
        {option(true, "Track inventory", "Purchases are entered with the items bought. Stock, average cost and cost of goods sold are worked out for you.")}
        {option(false, "Record purchase amounts only", "Purchases are entered by bill amount, with no items and no stock. They are booked to a Purchases account and no cost of goods sold is worked out. Supplier ledger, VAT, payments and payable ageing work as usual.")}
      </div>
      {dialog}
    </div>
  );
}
