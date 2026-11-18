"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { FREQUENCIES, FREQUENCY_LABEL, suggestPeriodLabel, type IncentiveFrequency } from "@/lib/payroll/incentive-rules";
import { createHeadingAction, createRoundAction, deleteHeadingAction, updateHeadingAction } from "./actions";

type Heading = { id: string; name: string; frequency: IncentiveFrequency; taxable: boolean; countsForRetirement: boolean; isActive: boolean };
type Round = { id: string; headingId: string; headingName: string; periodLabel: string; status: string; year: number; month: number; calendarSystem: string; people: number; total: number };
type HeadingForm = { name: string; frequency: IncentiveFrequency; taxable: boolean; countsForRetirement: boolean; isActive: boolean };
const blankHeading: HeadingForm = { name: "", frequency: "monthly", taxable: true, countsForRetirement: false, isActive: true };

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";

const Check = ({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; hint?: string }) => (
  <label className="flex items-start gap-2 text-sm text-ink">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
    <span>
      {children}
      {hint && <span className="block text-xs text-ink-2">{hint}</span>}
    </span>
  </label>
);

export function IncentivesWorkspace({
  headings,
  rounds,
  calendar,
  monthNames,
  thisYear,
  thisMonth,
  canCreate,
  canEdit,
  canDelete,
}: {
  headings: Heading[];
  rounds: Round[];
  calendar: string;
  monthNames: string[];
  thisYear: number;
  thisMonth: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const ask = useConfirm();
  const [tab, setTab] = useState<"rounds" | "headings">(headings.length === 0 ? "headings" : "rounds");
  const [heading, setHeading] = useState<{ id: string | null; form: HeadingForm } | null>(null);
  const [newRound, setNewRound] = useState<{ headingId: string; year: number; month: number; label: string; labelTouched: boolean; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const active = headings.filter((h) => h.isActive);
  const monthName = (m: number) => monthNames[m - 1] ?? String(m);

  async function saveHeading() {
    if (!heading) return;
    setBusy(true);
    try {
      if (heading.id) await updateHeadingAction({ ...heading.form, id: heading.id });
      else await createHeadingAction(heading.form);
      setHeading(null);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the heading", null);
    } finally {
      setBusy(false);
    }
  }

  async function removeHeading(h: Heading) {
    if (!(await ask(`Delete ${h.name}? Its account in the Chart of Accounts goes with it. A heading that already has rounds can only be switched off.`, { confirmLabel: "Delete", danger: true }))) return;
    try {
      await deleteHeadingAction({ id: h.id });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not delete the heading", null);
    }
  }

  function openNewRound() {
    const first = active[0];
    setNewRound({ headingId: first?.id ?? "", year: thisYear, month: thisMonth, label: first ? suggestPeriodLabel(first.frequency, monthName(thisMonth), thisYear, thisMonth) : "", labelTouched: false, note: "" });
  }

  // Until the person types their own label, it follows the heading and the pay month.
  function changeRound(patch: Partial<NonNullable<typeof newRound>>) {
    if (!newRound) return;
    const next = { ...newRound, ...patch };
    if (!next.labelTouched) {
      const h = headings.find((x) => x.id === next.headingId);
      next.label = h ? suggestPeriodLabel(h.frequency, monthName(next.month), next.year, next.month) : "";
    }
    setNewRound(next);
  }

  async function createRound() {
    if (!newRound) return;
    if (!newRound.headingId) return report("Choose an incentive heading.", null);
    setBusy(true);
    try {
      const id = await createRoundAction({ headingId: newRound.headingId, calendarSystem: calendar, year: newRound.year, month: newRound.month, periodLabel: newRound.label, note: newRound.note });
      setNewRound(null);
      router.push(`/payroll/incentives/${id}`);
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not open the round", null);
      setBusy(false);
    }
  }

  const years = [thisYear - 1, thisYear, thisYear + 1];
  const hf = heading?.form;
  const setH = (patch: Partial<HeadingForm>) => heading && setHeading({ ...heading, form: { ...heading.form, ...patch } });

  return (
    <div className="space-y-3">
      <Tabs
        items={[
          { id: "rounds", label: "Rounds" },
          { id: "headings", label: "Headings" },
        ]}
        value={tab}
        onChange={(id) => setTab(id as "rounds" | "headings")}
      />

      {tab === "rounds" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">One round is one heading for one period: choose the employees and the amount each gets, then approve it. Approved rounds are paid with the salary sheet of their pay month.</p>
            {canCreate && (
              <Button variant="primary" onClick={openNewRound} disabled={active.length === 0}>
                + New round
              </Button>
            )}
          </div>
          {active.length === 0 && <p className="rounded border border-line bg-app px-3 py-2 text-sm text-ink-2">Add an incentive heading first (Headings tab).</p>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Heading</th>
                  <th className={th}>For</th>
                  <th className={th}>Paid with</th>
                  <th className={`${th} text-right`}>Employees</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-hover">
                    <td className={td}>{r.headingName}</td>
                    <td className={td}>{r.periodLabel}</td>
                    <td className={td}>
                      {monthName(r.month)} {r.year}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.people}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.total.toFixed(2)}</td>
                    <td className={td}>{r.status === "approved" ? <StatusPill tone="success">Approved</StatusPill> : <StatusPill tone="pending">Draft</StatusPill>}</td>
                    <td className={`${td} text-right`}>
                      <Link href={`/payroll/incentives/${r.id}`} className="text-xs text-accent hover:underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {rounds.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-ink-3">
                      No rounds yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "headings" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">A heading is what the incentive is called (Sales incentive, Attendance bonus) and how it is treated. Each gets its own expense account under Salaries &gt; Performance incentives.</p>
            {canCreate && (
              <Button variant="primary" onClick={() => setHeading({ id: null, form: blankHeading })}>
                + Add heading
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Heading</th>
                  <th className={th}>Paid</th>
                  <th className={th}>Taxable</th>
                  <th className={th}>Counts for SSF/PF</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {headings.map((h) => (
                  <tr key={h.id} className="transition-colors hover:bg-hover">
                    <td className={td}>{h.name}</td>
                    <td className={td}>{FREQUENCY_LABEL[h.frequency]}</td>
                    <td className={td}>{h.taxable ? "Yes" : "No"}</td>
                    <td className={td}>{h.countsForRetirement ? "Yes" : "No"}</td>
                    <td className={td}>{h.isActive ? <StatusPill tone="success">On</StatusPill> : <StatusPill tone="neutral">Off</StatusPill>}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {canEdit && (
                        <button type="button" onClick={() => setHeading({ id: h.id, form: { name: h.name, frequency: h.frequency, taxable: h.taxable, countsForRetirement: h.countsForRetirement, isActive: h.isActive } })} className="mr-3 text-xs text-accent hover:underline">
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => removeHeading(h)} className="text-xs text-red-600 hover:underline">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {headings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                      No headings yet. Add one, for example Sales incentive, paid every month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {heading && hf && (
        <Modal
          title={heading.id ? "Edit heading" : "Add heading"}
          description={heading.id ? "Changes apply to months not yet finalized. Finished payroll keeps what it paid." : undefined}
          onClose={() => setHeading(null)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setHeading(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={saveHeading}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Name" required>
              <Input autoFocus value={hf.name} onChange={(e) => setH({ name: e.target.value })} placeholder="e.g. Sales incentive" />
            </Field>
            <Field label="How often is it paid?" hint="Only used to suggest a name for each round and to remind you. Who gets it, and how much, is chosen in each round.">
              <Select value={hf.frequency} onChange={(e) => setH({ frequency: e.target.value as IncentiveFrequency })}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </Select>
            </Field>
            <Check checked={hf.taxable} onChange={(v) => setH({ taxable: v })} hint="Salary tax is worked out on it, once, in the month it is paid.">
              Taxable
            </Check>
            <Check checked={hf.countsForRetirement} onChange={(v) => setH({ countsForRetirement: v })} hint="Adds to the pay SSF and PF contributions are worked out on.">
              Counts toward SSF/PF
            </Check>
            {heading.id && (
              <Check checked={hf.isActive} onChange={(v) => setH({ isActive: v })} hint="Switched off, it can't be used for new rounds. Old rounds stay.">
                On
              </Check>
            )}
          </div>
        </Modal>
      )}

      {newRound && (
        <Modal
          title="New round"
          onClose={() => setNewRound(null)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setNewRound(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={createRound}>
                Open round
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Heading" required>
              <Select value={newRound.headingId} onChange={(e) => changeRound({ headingId: e.target.value })}>
                {active.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid with the salary of" required>
                <Select value={newRound.month} onChange={(e) => changeRound({ month: Number(e.target.value) })}>
                  {monthNames.map((n, i) => (
                    <option key={n} value={i + 1}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Year" required>
                <Select value={newRound.year} onChange={(e) => changeRound({ year: Number(e.target.value) })}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="What it is for" required hint="For example Quarter 1 2083. A heading can't have two rounds with the same name.">
              <Input value={newRound.label} onChange={(e) => changeRound({ label: e.target.value, labelTouched: true })} />
            </Field>
            <Field label="Note">
              <Textarea value={newRound.note} onChange={(e) => changeRound({ note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {dialog}
    </div>
  );
}
