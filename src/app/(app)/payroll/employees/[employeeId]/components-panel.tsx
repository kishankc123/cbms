"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, controlClass } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { assignComponent, endComponentAssignment } from "../actions";

import { AmountInput } from "@/components/ui/amount-input";
type Catalog = { id: string; name: string; type: string; amount: string; calcType: string; recurrence: string; taxable: boolean; countsForRetirement: boolean };
type Assignment = { id: string; componentId: string; amount: string | null; effectiveFrom: string; effectiveTo: string | null; notes: string | null };

// What this employee is paid on top of basic salary (and what is taken off): the components assigned to them, from when to when.
export function SalaryComponentsPanel({ employeeId, catalog, assignments }: { employeeId: string; catalog: Catalog[]; assignments: Assignment[] }) {
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const [adding, setAdding] = useState(false);
  const [componentId, setComponentId] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const chosen = byId.get(componentId);
  const today = todayIso();

  const figure = (c: Catalog, a: string | null) => {
    const n = Number(a ?? c.amount);
    return c.calcType === "percent" ? `${n}% of basic` : n.toFixed(2);
  };

  function open() {
    setComponentId(catalog[0]?.id ?? "");
    setAmount("");
    setFrom(todayIso());
    setNotes("");
    setAdding(true);
  }

  async function save() {
    if (!chosen) return report("Choose a component.", null);
    setBusy(true);
    try {
      await assignComponent({ employeeId, componentId, amount: amount.trim() === "" ? null : parseFloat(amount), effectiveFrom: from, notes });
      setAdding(false);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not assign the component", null);
    } finally {
      setBusy(false);
    }
  }

  async function end(a: Assignment, c: Catalog | undefined) {
    const once = c?.recurrence === "one_time";
    if (!(await ask(once ? `Remove this ${c?.name ?? "entry"}? It has not been paid in a finished payroll run.` : `Stop ${c?.name ?? "this component"} from today? Earlier months keep it.`, { confirmLabel: once ? "Remove" : "Stop", danger: once }))) return;
    try {
      await endComponentAssignment({ assignmentId: a.id });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not change the assignment", null);
    }
  }

  const active = (a: Assignment, c: Catalog | undefined) => (c?.recurrence === "one_time" ? a.effectiveFrom >= today : a.effectiveFrom <= today && (!a.effectiveTo || a.effectiveTo >= today));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Allowances and deductions this employee gets, on top of basic salary. Add a one-time component, such as a bonus or overtime, in the month it is paid.</p>
        <Button variant="primary" onClick={open} disabled={catalog.length === 0}>
          + Assign component
        </Button>
      </div>
      {catalog.length === 0 && <p className="rounded border border-line bg-app px-3 py-2 text-sm text-ink-2">There are no components yet. Create them under Payroll setup first.</p>}

      <table className="w-full border-collapse text-[13px]">
        <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr>
            <th className="px-3 py-2 font-medium">Component</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">From</th>
            <th className="px-3 py-2 font-medium">To</th>
            <th className="px-3 py-2 font-medium">Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => {
            const c = byId.get(a.componentId);
            const on = active(a, c);
            return (
              <tr key={a.id} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-3 py-2">
                  {c?.name ?? "Deleted component"} {c?.recurrence === "one_time" && <StatusPill tone="pending">One time</StatusPill>}
                </td>
                <td className="px-3 py-2 capitalize">{c?.type ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c ? figure(c, a.amount) : "—"}</td>
                <td className="px-3 py-2"><D value={a.effectiveFrom} /></td>
                <td className="px-3 py-2">{c?.recurrence === "one_time" ? "—" : a.effectiveTo ? <D value={a.effectiveTo} /> : "Ongoing"}</td>
                <td className="px-3 py-2">{a.notes ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {on && (
                    <button type="button" onClick={() => end(a, c)} className="text-xs text-red-600 hover:underline">
                      {c?.recurrence === "one_time" ? "Remove" : "Stop"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {assignments.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-ink-3">
                No components assigned. This employee is paid basic salary only.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {adding && (
        <Modal
          title="Assign component"
          onClose={() => setAdding(false)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={busy}>
                Assign
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Component" required>
              <Select value={componentId} onChange={(e) => setComponentId(e.target.value)}>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type}
                    {c.recurrence === "one_time" ? ", one time" : ""})
                  </option>
                ))}
              </Select>
            </Field>
            {chosen && (
              <Field label={chosen.calcType === "percent" ? "Percentage for this employee" : "Amount for this employee"} hint={`Leave empty to use the standard ${figure(chosen, null)}.`}>
                <AmountInput type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            <Field label={chosen?.recurrence === "one_time" ? "Paid in the month of" : "Starts from"} hint={chosen?.recurrence === "one_time" ? "It is added to the payroll run whose period holds this date." : "A change to a component already assigned ends the old one the day before."}>
              <DatePicker value={from} onChange={(v) => setFrom(v)} className={controlClass} />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
