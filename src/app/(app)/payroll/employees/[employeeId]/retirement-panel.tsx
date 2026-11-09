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
import { SCHEME_NAMES } from "@/lib/payroll/employee-retirement";
import type { EmployeeScheme } from "@/lib/payroll/retirement-rules";
import { addRetirement, endRetirement } from "../actions";

import { AmountInput } from "@/components/ui/amount-input";
type Row = { id: string; scheme: string; registrationNumber: string | null; startDate: string; endDate: string | null; citMode: string | null; citValue: string | null; citEmployerValue: string | null; notes: string | null };

const schemeName = (s: string) => SCHEME_NAMES[s as EmployeeScheme] ?? s;

// Retirement schemes this employee is in. Nobody is enrolled unless someone enrolls them here. The rates come from the platform's payroll rules.
export function RetirementPanel({ employeeId, rows, warnings, rulesInForce }: { employeeId: string; rows: Row[]; warnings: string[]; rulesInForce: { verified: boolean } | null }) {
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const today = todayIso();
  const [adding, setAdding] = useState(false);
  const [scheme, setScheme] = useState<EmployeeScheme>("ssf");
  const [registration, setRegistration] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState("");
  const [citMode, setCitMode] = useState<"fixed" | "percent">("fixed");
  const [citValue, setCitValue] = useState("");
  const [citEmployer, setCitEmployer] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<{ row: Row; date: string } | null>(null);

  function open() {
    setScheme("ssf");
    setRegistration("");
    setStart(todayIso());
    setEnd("");
    setCitMode("fixed");
    setCitValue("");
    setCitEmployer("");
    setNotes("");
    setAdding(true);
  }

  async function save() {
    setBusy(true);
    try {
      await addRetirement({ employeeId, scheme, registrationNumber: registration, startDate: start, endDate: end, citMode: scheme === "cit" ? citMode : null, citValue: scheme === "cit" ? parseFloat(citValue) || null : null, citEmployerValue: scheme === "cit" && citEmployer.trim() !== "" ? parseFloat(citEmployer) : null, notes });
      setAdding(false);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save", null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnd() {
    if (!ending) return;
    if (!(await ask(`End ${schemeName(ending.row.scheme)} on ${ending.date}? No contributions are taken for later months. Earlier months keep what they paid.`, { confirmLabel: "End scheme" }))) return;
    setBusy(true);
    try {
      await endRetirement({ id: ending.row.id, endDate: ending.date });
      setEnding(null);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not end the scheme", null);
    } finally {
      setBusy(false);
    }
  }

  const current = (r: Row) => r.startDate <= today && (!r.endDate || r.endDate >= today);
  const detail = (r: Row) => {
    if (r.scheme !== "cit") return "Rates follow the payroll rules";
    const v = Number(r.citValue);
    const employer = r.citEmployerValue && Number(r.citEmployerValue) > 0 ? `, employer adds ${Number(r.citEmployerValue).toFixed(2)}` : "";
    return `${r.citMode === "percent" ? `${v}% of basic` : `${v.toFixed(2)} a month`}${employer}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Which retirement scheme this employee is in. Not everyone is eligible, so nobody is enrolled automatically. SSF and PF can&apos;t run together; CIT can be added to either.</p>
        <Button variant="primary" onClick={open}>
          + Enrol in a scheme
        </Button>
      </div>

      {rows.length === 0 && <p className="rounded border border-line bg-app px-3 py-2 text-sm text-ink-2">Not enrolled in any scheme. No contribution is taken, and net pay and tax are unaffected.</p>}
      {rows.length > 0 && !rulesInForce && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">No payroll rules are published for your country, so contributions can&apos;t be worked out yet. Ask your platform administrator.</p>}
      {rulesInForce && !rulesInForce.verified && rows.length > 0 && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">The contribution rates in force have not been confirmed against current law yet. Check them before relying on payroll.</p>}
      {warnings.map((w) => (
        <p key={w} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {w}
        </p>
      ))}

      {rows.length > 0 && (
        <table className="w-full border-collapse text-[13px]">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-3 py-2 font-medium">Scheme</th>
              <th className="px-3 py-2 font-medium">Registration no.</th>
              <th className="px-3 py-2 font-medium">Contribution</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">To</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-3 py-2">{schemeName(r.scheme)}</td>
                <td className="px-3 py-2">{r.registrationNumber ?? "—"}</td>
                <td className="px-3 py-2">{detail(r)}</td>
                <td className="px-3 py-2"><D value={r.startDate} /></td>
                <td className="px-3 py-2">{r.endDate ? <D value={r.endDate} /> : "Ongoing"}</td>
                <td className="px-3 py-2">{current(r) ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="neutral">{r.startDate > today ? "Starts later" : "Ended"}</StatusPill>}</td>
                <td className="px-3 py-2 text-right">
                  {(!r.endDate || r.endDate >= today) && (
                    <button type="button" onClick={() => setEnding({ row: r, date: today })} className="text-xs text-red-600 hover:underline">
                      End
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && (
        <Modal
          title="Enrol in a retirement scheme"
          onClose={() => setAdding(false)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={busy}>
                Enrol
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Scheme" required>
              <Select value={scheme} onChange={(e) => setScheme(e.target.value as EmployeeScheme)}>
                <option value="ssf">{SCHEME_NAMES.ssf}</option>
                <option value="pf">{SCHEME_NAMES.pf}</option>
                <option value="cit">{SCHEME_NAMES.cit}</option>
              </Select>
            </Field>
            <Field label="Registration number" required={scheme === "ssf"} hint={scheme === "ssf" ? "SSF contributions are not worked out without it." : "Shown on contribution reports."}>
              <Input value={registration} onChange={(e) => setRegistration(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contributions start" required>
                <DatePicker value={start} onChange={(v) => setStart(v)} className={controlClass} />
              </Field>
              <Field label="Contributions end" hint="Leave empty for ongoing.">
                <DatePicker value={end} onChange={(v) => setEnd(v)} className={controlClass} />
              </Field>
            </div>
            {scheme === "cit" ? (
              <div className="space-y-3 rounded border border-line p-3">
                <p className="text-xs text-ink-2">CIT has no fixed rate. Enter what the employee chose to put in each month.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contribution is">
                    <Select value={citMode} onChange={(e) => setCitMode(e.target.value as "fixed" | "percent")}>
                      <option value="fixed">A fixed amount a month</option>
                      <option value="percent">A percentage of basic salary</option>
                    </Select>
                  </Field>
                  <Field label={citMode === "percent" ? "Percentage" : "Amount"} required>
                    <AmountInput type="number" step="0.01" min="0" value={citValue} onChange={(e) => setCitValue(e.target.value)} />
                  </Field>
                </div>
                <Field label="Employer adds a month (if any)">
                  <AmountInput type="number" step="0.01" min="0" value={citEmployer} onChange={(e) => setCitEmployer(e.target.value)} />
                </Field>
              </div>
            ) : (
              <p className="text-xs text-ink-2">Employee and employer rates come from the payroll rules published for your country. They are not typed in per employee.</p>
            )}
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
        </Modal>
      )}

      {ending && (
        <Modal
          title={`End ${schemeName(ending.row.scheme)}`}
          onClose={() => setEnding(null)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setEnding(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmEnd} loading={busy}>
                End scheme
              </Button>
            </>
          }
        >
          <Field label="Last day of contributions" required>
            <DatePicker value={ending.date} onChange={(v) => setEnding({ ...ending, date: v })} className={controlClass} />
          </Field>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
