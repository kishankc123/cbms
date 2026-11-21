"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useProblem } from "@/components/problem-dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/field";
import { AttendanceHistory } from "./attendance-history";
import { D } from "@/components/calendar/date-text";
import { dayState, markProblem, monthTotals, NEXT_STATUS, type AttendanceStatus } from "@/lib/payroll/attendance-rules";
import type { AttendanceMonth } from "@/lib/payroll/attendance";
import { markAttendanceChecked, clearAttendanceCheck, setAttendance } from "../employees/attendance-actions";

const LETTER: Record<AttendanceStatus, string> = { present: "·", absent: "A", leave: "L", half_day: "H" };
const CELL: Record<AttendanceStatus, string> = {
  present: "text-ink-3",
  absent: "bg-[var(--danger-bg)] text-[var(--danger-text)] font-medium",
  leave: "bg-[var(--warning-bg)] text-[var(--warning-text)] font-medium",
  half_day: "bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium",
};
const CHOICES: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "leave", label: "Leave" },
  { value: "half_day", label: "Half day" },
];
const th = "border-b border-line bg-app px-1 py-1.5 text-center text-xs font-medium text-ink-2";

// The attendance of one payroll month: a sheet of employees by day, and a day view for marking on a phone. Unmarked days count as present, so only
// the exceptions are touched. Days before someone joined, after they left, and days still to come can't be marked; a finalized month is read-only.
export function AttendanceSheet({
  data,
  monthName,
  today,
  current,
  canEdit,
}: {
  data: AttendanceMonth;
  monthName: string;
  today: string;
  /** The month the organization is in now: nothing after it can be opened. */
  current: { year: number; month: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [records, setRecords] = useState(data.records);
  const [view, setView] = useState<"month" | "day">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Undoing a check asks why; the reason stays in the month's history.
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState("");
  const holidays = useMemo(() => new Set(data.days.filter((d) => d.holiday).map((d) => d.iso)), [data.days]);
  const dates = useMemo(() => data.days.map((d) => d.iso), [data.days]);
  const editable = canEdit && !data.locked;
  // The day view opens on today, or on the last day of a month that is over.
  const [pick, setPick] = useState(() => (today >= data.periodStart && today <= data.periodEnd ? today : dates[dates.length - 1]));

  const go = (y: number, m: number) => router.push(`/payroll/attendance?y=${y}&m=${m}`);
  const prev = data.month === 1 ? { y: data.year - 1, m: 12 } : { y: data.year, m: data.month - 1 };
  const next = data.month === 12 ? { y: data.year + 1, m: 1 } : { y: data.year, m: data.month + 1 };
  const canNext = data.year < current.year || (data.year === current.year && data.month < current.month);

  async function mark(employeeId: string, date: string, status: AttendanceStatus) {
    const key = `${employeeId}|${date}`;
    if (busy === key) return;
    const before = records[employeeId]?.[date];
    setRecords((r) => {
      const mine = { ...(r[employeeId] ?? {}) };
      if (status === "present") delete mine[date];
      else mine[date] = status;
      return { ...r, [employeeId]: mine };
    });
    setBusy(key);
    try {
      await setAttendance({ employeeId, date, status });
    } catch (e) {
      setRecords((r) => {
        const mine = { ...(r[employeeId] ?? {}) };
        if (before) mine[date] = before;
        else delete mine[date];
        return { ...r, [employeeId]: mine };
      });
      report(e instanceof Error ? e.message : "Could not save", null);
    } finally {
      setBusy(null);
    }
  }

  async function toggleChecked() {
    if (data.checked) {
      setUndoReason("");
      setUndoing(true);
      return;
    }
    setChecking(true);
    try {
      await markAttendanceChecked({ periodStart: data.periodStart, periodEnd: data.periodEnd });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save", null);
    } finally {
      setChecking(false);
    }
  }

  async function confirmUndo() {
    setChecking(true);
    try {
      await clearAttendanceCheck({ periodStart: data.periodStart, reason: undoReason });
      setUndoing(false);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save", null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" aria-label="Earlier month" onClick={() => go(prev.y, prev.m)}>
            <ChevronLeft size={15} />
          </Button>
          <span className="min-w-36 text-center text-[15px] font-medium text-ink">
            {monthName} {data.year}
          </span>
          <Button size="sm" variant="secondary" aria-label="Later month" disabled={!canNext} title={canNext ? undefined : "There is no attendance for a month that hasn't started"} onClick={() => go(next.y, next.m)}>
            <ChevronRight size={15} />
          </Button>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-line-strong text-[13px]">
          {(["month", "day"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`h-8 px-3 ${view === v ? "bg-accent text-[var(--on-accent)]" : "text-ink hover:bg-hover"}`}>
              {v === "month" ? "Month sheet" : "Day"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px]">
        <p className="text-ink-2">
          {data.locked ? "Payroll for this month is finalized, so its attendance is read-only." : editable ? "Unmarked days count as present. Tap a day to change it: absent, leave, half day, then back to present." : "You can see attendance here but not change it."}
        </p>
        <div className="flex items-center gap-2">
          {data.checked ? (
            <StatusPill tone="success">
              Checked{data.checked.by ? ` by ${data.checked.by}` : ""} on <D value={data.checked.at} />
            </StatusPill>
          ) : (
            <StatusPill tone="pending">Not checked yet</StatusPill>
          )}
          {canEdit && (data.checked || data.periodStart <= today) && (
            <Button size="sm" variant={data.checked ? "ghost" : "primary"} loading={checking} onClick={toggleChecked}>
              {data.checked ? "Undo" : "Mark month as checked"}
            </Button>
          )}
        </div>
      </div>

      <AttendanceHistory periodStart={data.periodStart} refreshKey={`${data.checked?.at ?? ""}|${data.checked?.by ?? ""}|${JSON.stringify(records).length}`} />

      {undoing && (
        <Modal
          size="sm"
          title="Undo the check?"
          description="The month goes back to not checked. Who checked it and when stays in the history."
          onClose={() => setUndoing(false)}
          dismissible={!checking}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setUndoing(false)} disabled={checking}>
                Keep it checked
              </Button>
              <Button type="button" variant="primary" onClick={confirmUndo} loading={checking}>
                Undo the check
              </Button>
            </>
          }
        >
          <Textarea value={undoReason} onChange={(e) => setUndoReason(e.target.value)} rows={3} placeholder="Reason (required)" aria-label="Reason for undoing the check" />
        </Modal>
      )}

      {data.employees.length === 0 && <p className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-3">No employee was employed in this month.</p>}

      {view === "month" && data.employees.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-2">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className={`${th} sticky left-0 z-10 min-w-40 !text-left`}>Employee</th>
                  {data.days.map((d) => (
                    <th key={d.iso} className={`${th} min-w-[26px] ${d.holiday ? "bg-surface-2" : ""} ${d.iso === today ? "text-accent" : ""}`}>
                      {d.day}
                    </th>
                  ))}
                  {["Present", "Absent", "Leave", "Half"].map((h) => (
                    <th key={h} className={`${th} whitespace-nowrap px-2`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => {
                  const mine = records[e.id] ?? {};
                  const totals = monthTotals(e, dates, mine, holidays, today);
                  return (
                    <tr key={e.id} className="border-b border-line">
                      <td className="sticky left-0 z-10 bg-surface px-2 py-1 text-left">
                        <p className="font-medium text-ink">{e.name}</p>
                        <p className="text-[11px] text-ink-2">{e.joiningDate > data.periodStart ? <>Joined <D value={e.joiningDate} /></> : e.leavingDate && e.leavingDate < data.periodEnd ? <>Left <D value={e.leavingDate} /></> : e.code}</p>
                      </td>
                      {data.days.map((d) => {
                        const state = dayState(e, d.iso, today);
                        const status = mine[d.iso] ?? "present";
                        const open = state === "open";
                        return (
                          <td key={d.iso} className={`p-px text-center ${d.holiday ? "bg-surface-2" : ""}`}>
                            <button
                              type="button"
                              disabled={!open || !editable}
                              title={open ? undefined : markProblem({ fullName: e.name, joiningDate: e.joiningDate, leavingDate: e.leavingDate }, d.iso, today) ?? undefined}
                              onClick={() => void mark(e.id, d.iso, NEXT_STATUS[status])}
                              className={`flex h-7 w-6 items-center justify-center rounded ${open ? CELL[status] : "cursor-not-allowed bg-[var(--bg-neutral)] opacity-50"} ${open && editable ? "hover:ring-1 hover:ring-line-strong" : ""} ${d.iso === today ? "ring-1 ring-accent" : ""}`}
                              aria-label={`${e.name}, ${d.day}: ${CHOICES.find((c) => c.value === status)?.label}`}
                            >
                              {open ? LETTER[status] : ""}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 text-center tabular-nums">{totals.present}</td>
                      <td className="px-2 text-center tabular-nums">{totals.absent}</td>
                      <td className="px-2 text-center tabular-nums">{totals.leave}</td>
                      <td className="px-2 text-center tabular-nums">{totals.half}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 px-1 text-xs text-ink-2">
            <span>A absent</span>
            <span>L leave</span>
            <span>H half day</span>
            <span>Grey: not employed that day, or still to come</span>
            <span>Shaded column: weekly holiday</span>
          </div>
        </section>
      )}

      {view === "day" && data.employees.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" aria-label="Earlier day" disabled={pick <= dates[0]} onClick={() => setPick(dates[Math.max(dates.indexOf(pick) - 1, 0)])}>
                <ChevronLeft size={15} />
              </Button>
              <span className="min-w-40 text-center text-[14px] font-medium text-ink">
                <D value={pick} style="long" />
              </span>
              <Button size="sm" variant="secondary" aria-label="Later day" disabled={pick >= dates[dates.length - 1] || pick >= today} onClick={() => setPick(dates[Math.min(dates.indexOf(pick) + 1, dates.length - 1)])}>
                <ChevronRight size={15} />
              </Button>
            </div>
            {pick === today && <StatusPill tone="neutral">Today</StatusPill>}
            {holidays.has(pick) && <StatusPill tone="pending">Holiday</StatusPill>}
          </div>
          {data.employees.map((e) => {
            const state = dayState(e, pick, today);
            const status = records[e.id]?.[pick] ?? "present";
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <div>
                  <p className="font-medium text-ink">{e.name}</p>
                  <p className="text-xs text-ink-2">{state === "open" ? e.code : markProblem({ fullName: e.name, joiningDate: e.joiningDate, leavingDate: e.leavingDate }, pick, today)}</p>
                </div>
                <div className="flex gap-1.5">
                  {CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      disabled={state !== "open" || !editable}
                      onClick={() => void mark(e.id, pick, c.value)}
                      className={`h-8 min-w-16 rounded-lg border px-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${state === "open" && status === c.value ? (c.value === "present" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]" : c.value === "absent" ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]" : c.value === "leave" ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]" : "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]") : "border-line-strong text-ink hover:bg-hover"}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {dialog}
    </div>
  );
}
