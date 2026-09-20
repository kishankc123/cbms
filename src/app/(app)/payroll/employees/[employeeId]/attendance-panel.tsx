"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setAttendance, type AttendanceStatus } from "../attendance-actions";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { monthCells, monthNames, weekdayOf } from "@/lib/calendar";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "leave", label: "Leave" },
  { value: "half_day", label: "Half day" },
];

export function AttendancePanel({
  employeeId,
  month,
  year,
  records,
}: {
  employeeId: string;
  month: number;
  year: number;
  records: Record<string, AttendanceStatus>;
}) {
  const router = useRouter();
  const calendar = useCalendar();
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedYear, setSelectedYear] = useState(year);
  const [saving, setSaving] = useState<string | null>(null);

  // Days of the selected month in the organization's calendar; each cell keeps the
  // real AD date, which is what attendance is stored and payroll is computed on.
  const days = useMemo(() => {
    const cells = monthCells(calendar, selectedYear, selectedMonth);
    return (cells?.days ?? []).map((d) => ({ dateStr: d.iso, dayOfWeek: weekdayOf(d.iso), label: d.day }));
  }, [calendar, selectedMonth, selectedYear]);

  async function handleChange(dateStr: string, status: AttendanceStatus) {
    setSaving(dateStr);
    try {
      await setAttendance({ employeeId, date: dateStr, status });
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  const presentCount = days.filter((d) => (records[d.dateStr] ?? "present") === "present").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            {monthNames(calendar).map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <p className="text-sm text-gray-600">
          Present: <span className="font-medium text-gray-900">{presentCount}</span> / {days.length} days
        </p>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const status = records[d.dateStr] ?? "present";
          const isWeekend = d.dayOfWeek === 6;
          return (
            <div key={d.dateStr} className={`rounded border p-2 text-xs ${isWeekend ? "bg-gray-50 border-gray-200" : "border-gray-200 bg-white"}`}>
              <div className="mb-1 font-medium text-gray-700">{d.label}</div>
              <select
                value={status}
                onChange={(e) => handleChange(d.dateStr, e.target.value as AttendanceStatus)}
                disabled={saving === d.dateStr}
                className="w-full rounded border border-gray-300 px-1 py-1 text-xs"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
