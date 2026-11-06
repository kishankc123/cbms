"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { updateTaxInfo } from "../actions";

type Employee = { id: string; panNumber: string | null; taxStatus?: string | null; taxResidency?: string; sstEligible?: boolean; priorIncome?: string; priorTds?: string };

const money = (v?: string) => Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// What the employee's salary tax depends on. Single or couple, earlier-employer figures and PAN are edited with Edit employee; residency and the
// first-band exemption are set here. The exemption is confirmed on its own: being in SSF does not by itself decide it.
export function TaxPanel({ employee, canExempt }: { employee: Employee; canExempt: boolean }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const toast = useToast();
  const [residency, setResidency] = useState(employee.taxResidency === "non_resident" ? "non_resident" : "resident");
  const [sst, setSst] = useState(Boolean(employee.sstEligible));
  const [busy, setBusy] = useState(false);
  const changed = residency !== (employee.taxResidency ?? "resident") || sst !== Boolean(employee.sstEligible);

  async function save() {
    setBusy(true);
    try {
      await updateTaxInfo({ employeeId: employee.id, taxResidency: residency as "resident" | "non_resident", sstEligible: sst });
      toast.success("Tax details saved");
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save", null);
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Salary tax</h3>
        <div>
          {row("PAN", employee.panNumber || "Not recorded")}
          {row("Tax status (slabs)", employee.taxStatus ? (employee.taxStatus === "couple" ? "Couple" : "Single") : "Not chosen (Single is used)")}
          {row("Income from an earlier employer this year", money(employee.priorIncome))}
          {row("Tax already withheld by them", money(employee.priorTds))}
        </div>
        <p className="text-xs text-ink-2">Change these with Edit on the Profile tab.</p>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-ink">Residency and exemption</h3>
        <Field label="Tax residency">
          <Select value={residency} onChange={(e) => setResidency(e.target.value)}>
            <option value="resident">Resident</option>
            <option value="non_resident">Non-resident</option>
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={sst} onChange={(e) => setSst(e.target.checked)} className="mt-0.5" />
          <span>
            Confirmed for the first-band (social security tax) exemption
            <span className="block text-xs text-ink-2">Only tick this once you have checked that this employee qualifies. Being in SSF does not decide it on its own.{!canExempt && " The employee is not in a scheme that allows it right now."}</span>
          </span>
        </label>
        <Button variant="primary" onClick={save} loading={busy} disabled={!changed}>
          Save
        </Button>
      </div>
      {dialog}
    </div>
  );
}
