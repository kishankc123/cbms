"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { entryProblem } from "@/lib/payroll/incentive-rules";
import { deleteRoundAction, saveRoundAction, setRoundStatusAction } from "../actions";

type Row = { key: number; employeeId: string; amount: string; note: string };
type Choice = { id: string; name: string; code: string };

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2 py-1.5";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Who gets how much in one round. Each employee appears once: the amount is one figure and the note says what it is made of.
export function RoundEditor({
  roundId,
  status,
  locked,
  employees,
  initial,
  canEdit,
  canDelete,
}: {
  roundId: string;
  status: string;
  locked: boolean;
  note: string;
  employees: Choice[];
  initial: { employeeId: string; amount: string; note: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const ask = useConfirm();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [seq, setSeq] = useState(initial.length + 1);
  const [rows, setRows] = useState<Row[]>(() => (initial.length > 0 ? initial.map((r, i) => ({ key: i, ...r })) : [{ key: 0, employeeId: "", amount: "", note: "" }]));
  const [busy, setBusy] = useState(false);
  const readOnly = locked || !canEdit;
  const approved = status === "approved";

  const entries = () => rows.filter((r) => r.employeeId || r.amount).map((r) => ({ employeeId: r.employeeId, amount: parseFloat(r.amount) || 0, note: r.note }));
  const total = round2(entries().reduce((s, e) => s + e.amount, 0));
  const people = new Set(entries().map((e) => e.employeeId).filter(Boolean)).size;
  const set = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow() {
    setRows((prev) => [...prev, { key: seq, employeeId: "", amount: "", note: "" }]);
    setSeq((n) => n + 1);
  }

  async function save(approve: boolean) {
    const problem = entryProblem(entries());
    if (problem) return report(problem, null);
    setBusy(true);
    try {
      await saveRoundAction({ roundId, entries: entries(), approve });
      toast.success(approve ? "Round approved. It is in the salary sheet of its pay month." : approved ? "Saved. The salary sheet of its pay month is worked out again." : "Saved as a draft.");
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the round", null);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!(await ask("Take this round back to a draft? It leaves the salary sheet until it is approved again.", { confirmLabel: "Back to draft" }))) return;
    setBusy(true);
    try {
      await setRoundStatusAction({ roundId, status: "draft" });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not change the round", null);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await ask("Delete this round and everything entered in it?", { confirmLabel: "Delete", danger: true }))) return;
    setBusy(true);
    try {
      await deleteRoundAction({ roundId });
      router.push("/payroll/incentives");
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not delete the round", null);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {approved ? <StatusPill tone="success">Approved</StatusPill> : <StatusPill tone="pending">Draft</StatusPill>}
        <p className="text-sm text-ink-2">
          {people} employee{people === 1 ? "" : "s"}, total <span className="font-medium text-ink">{total.toFixed(2)}</span>
        </p>
      </div>
      {locked && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">The payroll for this month is finalized, so this round can&apos;t be changed.</p>}
      {!locked && !approved && <p className="rounded border border-line bg-app px-3 py-2 text-sm text-ink-2">This round is a draft: it is not in any salary sheet until you approve it.</p>}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Employee</th>
              <th className={`${th} w-40 text-right`}>Amount</th>
              <th className={th}>Note</th>
              <th className={`${th} w-10`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={td}>
                  <Select value={r.employeeId} disabled={readOnly} onChange={(e) => set(r.key, { employeeId: e.target.value })}>
                    <option value="">Choose employee</option>
                    {employees.map((e) => (
                      // Someone already chosen in another row can't be chosen again.
                      <option key={e.id} value={e.id} disabled={e.id !== r.employeeId && rows.some((x) => x.employeeId === e.id)}>
                        {e.code} {e.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className={td}>
                  <AmountInput type="number" step="0.01" min="0" disabled={readOnly} value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} className="w-full text-right" />
                </td>
                <td className={td}>
                  <Input value={r.note} disabled={readOnly} onChange={(e) => set(r.key, { note: e.target.value })} placeholder="Why, or what target" />
                </td>
                <td className={`${td} text-center`}>
                  {!readOnly && (
                    <button type="button" aria-label="Remove row" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : [{ key: r.key, employeeId: "", amount: "", note: "" }]))} className="text-ink-3 hover:text-ink">
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button size="sm" icon={<Plus size={15} />} onClick={addRow}>
          Add employee
        </Button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div>
          {canDelete && !locked && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              Delete round
            </Button>
          )}
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            {approved ? (
              <>
                <Button onClick={reopen} disabled={busy}>
                  Back to draft
                </Button>
                <Button variant="primary" loading={busy} onClick={() => save(false)}>
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button loading={busy} onClick={() => save(false)}>
                  Save draft
                </Button>
                <Button variant="primary" loading={busy} onClick={() => save(true)}>
                  Save and approve
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}
