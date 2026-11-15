"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { ADJUSTMENT_KIND_LABEL, type AdjustmentKind, type RunAdjustment } from "@/lib/payroll/adjustment-labels";
import { addRunAdjustmentAction, removeRunAdjustmentAction } from "../actions";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";

// One-off allowances and deductions for single employees in this month's run. Every figure of the run is worked out again when one is added or removed.
export function AdjustmentsPanel({ runId, canAdjust, employees, adjustments }: { runId: string; canAdjust: boolean; employees: { id: string; name: string }[]; adjustments: RunAdjustment[] }) {
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(a: RunAdjustment) {
    if (!(await ask(`Remove the ${ADJUSTMENT_KIND_LABEL[a.kind].toLowerCase()} of ${a.amount.toFixed(2)} for ${a.employeeName}? The run is worked out again without it.`, { confirmLabel: "Remove" }))) return;
    setBusy(a.id);
    try {
      await removeRunAdjustmentAction({ runId, adjustmentId: a.id });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not remove the adjustment", null);
    } finally {
      setBusy(null);
    }
  }

  if (!canAdjust && adjustments.length === 0) return null;
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Adjustments</h2>
          <p className="text-xs text-ink-2">A one-off extra or deduction for one employee this month, with a reason. The run is worked out again to include it.</p>
        </div>
        {canAdjust && (
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setOpen(true)}>
            Add adjustment
          </Button>
        )}
      </div>
      {adjustments.length === 0 ? (
        <p className="text-[13px] text-ink-2">No adjustments in this run.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Employee</th>
                <th className={th}>What</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Reason</th>
                {canAdjust && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.employeeName}</td>
                  <td className={td}>{ADJUSTMENT_KIND_LABEL[a.kind]}</td>
                  <td className={`${td} tnum text-right`}>{a.amount.toFixed(2)}</td>
                  <td className={`${td} text-ink-2`}>{a.reason}</td>
                  {canAdjust && (
                    <td className={`${td} text-right`}>
                      <Button size="sm" icon={<Trash2 size={14} />} loading={busy === a.id} onClick={() => remove(a)} aria-label={`Remove the adjustment for ${a.employeeName}`}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AddAdjustment runId={runId} employees={employees} onClose={() => setOpen(false)} />}
      {dialog}
    </section>
  );
}

function AddAdjustment({ runId, employees, onClose }: { runId: string; employees: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [employeeId, setEmployeeId] = useState(employees.length === 1 ? employees[0].id : "");
  const [direction, setDirection] = useState<"allowance" | "deduction">("allowance");
  const [taxable, setTaxable] = useState(true);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const kind: AdjustmentKind = direction === "deduction" ? "deduction" : taxable ? "allowance" : "allowance_free";

  async function save() {
    if (!employeeId) return report("Choose the employee.", null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return report("Enter an amount greater than zero.", null);
    if (reason.trim().length < 3) return report("Give a short reason, so the adjustment can be understood later.", null);
    setSaving(true);
    try {
      await addRunAdjustmentAction({ runId, employeeId, kind, amount: n, reason });
      router.refresh();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not add the adjustment", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add adjustment"
      description="A one-off change to one employee's pay this month."
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Add and recalculate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Employee" required>
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose an employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What is it" required>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as "allowance" | "deduction")}>
            <option value="allowance">An extra, added to the pay (allowance)</option>
            <option value="deduction">Something taken from the pay (deduction)</option>
          </Select>
        </Field>
        <Field label="Amount" required>
          <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right" />
        </Field>
        {direction === "allowance" && (
          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="mt-0.5" />
            <span>
              Taxable
              <span className="block text-xs text-ink-2">A taxable extra is included in the pay salary tax is worked on, and counts towards the retirement contributions. Untick it for an extra that is neither.</span>
            </span>
          </label>
        )}
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Festival gift, overtime in the last week, damaged equipment" />
        </Field>
      </div>
      {dialog}
    </Modal>
  );
}
