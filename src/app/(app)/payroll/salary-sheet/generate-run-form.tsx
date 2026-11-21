"use client";

import { useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { generatePayrollRun } from "./actions";
import { getAttendanceCheckNotice } from "../employees/attendance-actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { monthNames, todayIso, ymdOf } from "@/lib/calendar";

export function GenerateRunForm() {
  const router = useRouter();
  // Payroll months are months of the organization's calendar (Baisakh…Chaitra for BS).
  const calendar = useCalendar();
  const current = ymdOf(calendar, todayIso()) ?? ymdOf("AD", todayIso())!;
  const [month, setMonth] = useState(current.month);
  const [year, setYear] = useState(current.year);
  const [saving, setSaving] = useState(false);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
  const ask = useConfirm();

  async function handleGenerate() {
    setSaving(true);
    try {
      // Unmarked days count as present: ask before paying a month whose attendance nobody checked.
      const notice = await getAttendanceCheckNotice({ month, year, calendar });
      if (!notice.checked && !(await ask("Attendance for this month has not been marked as checked, so every day nobody marked will count as present. Generate payroll anyway?", { confirmLabel: "Generate anyway" }))) return;
      const runId = await generatePayrollRun({ month, year, calendar, employeeIds: [] });
      router.push(`/payroll/salary-sheet/${runId}`);
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to generate", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Payroll Month</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full">
            {monthNames(calendar).map((name, i) => (
              <option key={i} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Payroll Year{calendar === "BS" ? " (BS)" : ""}</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
        </div>
      </div>

      <p className="text-xs text-gray-500">Everyone employed during the month is included: active staff, anyone who joined during it and anyone who left during it. You can leave someone out, or add them back, on the run once it is made. Generating a month that already has a draft rebuilds that draft.</p>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={saving}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
        >
          {saving ? "Generating..." : "Generate salary sheet"}
        </button>
      </div>
      {dialog}
    </div>
  );
}
