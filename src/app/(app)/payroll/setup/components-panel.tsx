"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { addStarterComponents, createComponent, deleteComponent, updateComponent, type ComponentInput } from "./actions";

import { AmountInput } from "@/components/ui/amount-input";
type Component = { id: string; name: string; type: string; amount: string; taxable: boolean; calcType: string; countsForRetirement: boolean; recurrence: string; autoAssign: boolean };
type Form = { name: string; type: "allowance" | "deduction"; amount: string; taxable: boolean; calcType: "fixed" | "percent"; countsForRetirement: boolean; recurrence: "recurring" | "one_time"; autoAssign: boolean };

const blank: Form = { name: "", type: "allowance", amount: "", taxable: true, calcType: "fixed", countsForRetirement: false, recurrence: "recurring", autoAssign: false };
const toForm = (c: Component): Form => ({ name: c.name, type: c.type === "deduction" ? "deduction" : "allowance", amount: c.amount, taxable: c.taxable, calcType: c.calcType === "percent" ? "percent" : "fixed", countsForRetirement: c.countsForRetirement, recurrence: c.recurrence === "one_time" ? "one_time" : "recurring", autoAssign: c.autoAssign });
const toInput = (f: Form): ComponentInput => ({ ...f, amount: parseFloat(f.amount) || 0 });

const Check = ({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; hint?: string }) => (
  <label className="flex items-start gap-2 text-sm text-ink">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
    <span>
      {children}
      {hint && <span className="block text-xs text-ink-2">{hint}</span>}
    </span>
  </label>
);

export function ComponentsPanel({ components }: { components: Component[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const { report, dialog } = useProblem();
  const toast = useToast();
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    if (!editing.form.name.trim()) return report("Enter a name for the component.", null);
    setBusy(true);
    try {
      if (editing.id) await updateComponent({ ...toInput(editing.form), componentId: editing.id });
      else await createComponent(toInput(editing.form));
      setEditing(null);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the component", null);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Component) {
    if (!(await ask(`Delete ${c.name}? It is taken off every employee. Finished payroll keeps what was already paid.`, { confirmLabel: "Delete", danger: true }))) return;
    try {
      await deleteComponent({ componentId: c.id });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not delete the component", null);
    }
  }

  async function starter() {
    try {
      const n = await addStarterComponents();
      toast.success(n > 0 ? `Added ${n} suggested component${n === 1 ? "" : "s"}. Give each an amount and assign it to employees.` : "You already have all the suggested components.");
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not add the suggested components", null);
    }
  }

  const f = editing?.form;
  const set = (patch: Partial<Form>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Each employee gets the components assigned to them on their profile (Salary components). One-time components, such as a bonus or overtime, are assigned in the month they are paid.</p>
        <div className="flex shrink-0 gap-2">
          <Button onClick={starter}>Add suggested set</Button>
          <Button variant="primary" onClick={() => setEditing({ id: null, form: blank })}>
            + Add component
          </Button>
        </div>
      </div>

      <table className="w-full border-collapse text-[13px]">
        <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Name</th>
            <th className="px-2.5 py-1.5 font-medium">Type</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Amount</th>
            <th className="px-2.5 py-1.5 font-medium">Paid</th>
            <th className="px-2.5 py-1.5 font-medium">Taxable</th>
            <th className="px-2.5 py-1.5 font-medium">Counts for SSF/PF</th>
            <th className="px-2.5 py-1.5 font-medium">Given to</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.id} className="border-b border-line transition-colors hover:bg-hover">
              <td className="px-2.5 py-1.5">{c.name}</td>
              <td className="px-2.5 py-1.5 capitalize">{c.type}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{c.calcType === "percent" ? `${Number(c.amount)}% of basic` : Number(c.amount).toFixed(2)}</td>
              <td className="px-2.5 py-1.5">{c.recurrence === "one_time" ? <StatusPill tone="pending">One time</StatusPill> : "Every month"}</td>
              <td className="px-2.5 py-1.5">{c.type === "deduction" ? "—" : c.taxable ? "Yes" : "No"}</td>
              <td className="px-2.5 py-1.5">{c.type === "deduction" ? "—" : c.countsForRetirement ? "Yes" : "No"}</td>
              <td className="px-2.5 py-1.5">{c.autoAssign ? "Every employee" : "Assigned one by one"}</td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                <button type="button" onClick={() => setEditing({ id: c.id, form: toForm(c) })} className="mr-3 text-xs text-accent hover:underline">
                  Edit
                </button>
                <button type="button" onClick={() => remove(c)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {components.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-ink-3">
                No components yet. Add the suggested set to start from the usual allowances.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && f && (
        <Modal
          title={editing.id ? "Edit component" : "Add component"}
          description={editing.id ? "Changes apply to months not yet finalized. Finished payroll keeps what it paid." : undefined}
          onClose={() => setEditing(null)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={busy}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Name" required>
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={f.type} onChange={(e) => set({ type: e.target.value as Form["type"], countsForRetirement: e.target.value === "deduction" ? false : f.countsForRetirement })}>
                  <option value="allowance">Allowance (added to pay)</option>
                  <option value="deduction">Deduction (taken from pay)</option>
                </Select>
              </Field>
              <Field label="Paid">
                <Select value={f.recurrence} onChange={(e) => set({ recurrence: e.target.value as Form["recurrence"], autoAssign: e.target.value === "one_time" ? false : f.autoAssign })}>
                  <option value="recurring">Every month</option>
                  <option value="one_time">One time (bonus, overtime)</option>
                </Select>
              </Field>
              <Field label="Worked out as">
                <Select value={f.calcType} onChange={(e) => set({ calcType: e.target.value as Form["calcType"] })}>
                  <option value="fixed">Fixed amount</option>
                  <option value="percent">Percentage of basic salary</option>
                </Select>
              </Field>
              <Field label={f.calcType === "percent" ? "Percentage (default)" : "Amount (default)"} hint="Can be changed for one employee when assigning.">
                <AmountInput type="number" step="0.01" min="0" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />
              </Field>
            </div>
            {f.type === "allowance" && (
              <>
                <Check checked={f.taxable} onChange={(v) => set({ taxable: v })} hint="Counts as income for salary tax. Tax treatment depends on the law, so set it for each component.">
                  Taxable
                </Check>
                <Check checked={f.countsForRetirement} onChange={(v) => set({ countsForRetirement: v })} hint="Included in the salary that SSF or PF contributions are worked on, as well as basic salary.">
                  Counts toward SSF / PF
                </Check>
              </>
            )}
            {f.recurrence === "recurring" && (
              <Check checked={f.autoAssign} onChange={(v) => set({ autoAssign: v })} hint={editing.id ? "Applies to employees added from now on." : "Also given to every employee already on the payroll, from today."}>
                Give to every employee
              </Check>
            )}
          </div>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
