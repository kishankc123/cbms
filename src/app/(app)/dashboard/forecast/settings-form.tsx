"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { savePlanningSettings } from "./actions";

import { AmountInput } from "@/components/ui/amount-input";
const toNumber = (v: string): number | null => (v.trim() === "" ? null : Number(v));

// The three settings the forecast reads. Leaving the amount or the days empty means "work it out", which is the default.
export function PlanningSettingsForm({ reserveMonths, reserveOverride, defaultCollectionDays, learnedDays, learned, canEdit }: { reserveMonths: number; reserveOverride: number | null; defaultCollectionDays: number | null; learnedDays: number; learned: boolean; canEdit: boolean }) {
  const toast = useToast();
  const [months, setMonths] = useState(String(reserveMonths));
  const [override, setOverride] = useState(reserveOverride === null ? "" : String(reserveOverride));
  const [days, setDays] = useState(defaultCollectionDays === null ? "" : String(defaultCollectionDays));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await savePlanningSettings({ reserveMonths: Number(months), reserveOverride: toNumber(override), defaultCollectionDays: toNumber(days) });
      if (r.ok) toast.success("Planning settings saved");
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Months of fixed expenses to keep as reserve" hint="Payroll and recurring expenses, from the last 3 months.">
          <Input type="number" min={0} max={24} step={1} value={months} onChange={(e) => setMonths(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Or a fixed reserve amount" hint="Leave empty to use the months.">
          <AmountInput type="number" min={0} step="0.01" value={override} onChange={(e) => setOverride(e.target.value)} disabled={!canEdit} placeholder="Worked out" />
        </Field>
        <Field label="Days customers take to pay" hint={`Used when an invoice has no due date. Empty: ${learnedDays} days${learned ? ", from your own history" : ", a standard until there is history"}.`}>
          <Input type="number" min={0} max={365} step={1} value={days} onChange={(e) => setDays(e.target.value)} disabled={!canEdit} placeholder={String(learnedDays)} />
        </Field>
      </div>
      {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}
      {canEdit ? (
        <Button size="sm" variant="primary" loading={pending} onClick={save}>
          Save settings
        </Button>
      ) : (
        <p className="text-xs text-ink-2">You can see these settings but not change them.</p>
      )}
    </div>
  );
}
