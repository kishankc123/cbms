"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setAttendance, type AttendanceStatus } from "../attendance-actions";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "leave", label: "Leave" },
  { value: "half_day", label: "Half day" },
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

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
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedYear, setSelectedYear] = useState(year);
  const [saving, setSaving] = useState<string | null>(null);

  const days = useMemo(() => {
    const count = daysInMonth(selectedYear, selectedMonth);
    return Array.from({ length: count }, (_, i) => {
      const d = i + 1;
      const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
      return { dateStr, dayOfWeek, label: d };
    });
  }, [selectedMonth, selectedYear]);

  function goToMonth(monthYear: string) {
    const [y, m] = monthYear.split("-").map(Number);
    setSelectedYear(y);
    setSelectedMonth(m);
  }

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
        <input
          type="month"
          value={`${selectedYear}-${String(selectedMonth).padStart(2, "0")}`}
          onChange={(e) => goToMonth(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
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
