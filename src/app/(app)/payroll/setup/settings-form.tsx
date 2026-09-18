"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSettings } from "./actions";

const PRORATION_METHODS = [
  { value: "prorate", label: "Prorate salary based on effective date" },
  { value: "new_full_month", label: "Apply new salary for entire month" },
  { value: "old_full_month", label: "Apply old salary for entire month" },
] as const;

const WORKING_DAYS_METHODS = [
  { value: "calendar_days", label: "Calendar days" },
  { value: "exclude_weekly_holidays", label: "Exclude weekly holidays" },
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Settings = {
  prorationMethod: (typeof PRORATION_METHODS)[number]["value"];
  workingDaysMethod: (typeof WORKING_DAYS_METHODS)[number]["value"];
  weeklyHolidays: number[];
  publicHolidays: string[];
  payrollStartDay: number;
  payrollEndDay: number;
  roundingRule: string;
};

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [prorationMethod, setProrationMethod] = useState(settings.prorationMethod);
  const [workingDaysMethod, setWorkingDaysMethod] = useState(settings.workingDaysMethod);
  const [weeklyHolidays, setWeeklyHolidays] = useState<number[]>(settings.weeklyHolidays);
  const [publicHolidaysText, setPublicHolidaysText] = useState(settings.publicHolidays.join(", "));
  const [payrollStartDay, setPayrollStartDay] = useState(String(settings.payrollStartDay));
  const [payrollEndDay, setPayrollEndDay] = useState(String(settings.payrollEndDay));
  const [roundingRule, setRoundingRule] = useState(settings.roundingRule);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleWeekday(day: number) {
    setWeeklyHolidays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSettings({
        prorationMethod,
        workingDaysMethod,
        weeklyHolidays,
        publicHolidays: publicHolidaysText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        payrollStartDay: parseInt(payrollStartDay, 10) || 1,
        payrollEndDay: parseInt(payrollEndDay, 10) || 31,
        roundingRule,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Salary Settings</h3>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Salary change proration method</label>
          <select value={prorationMethod} onChange={(e) => setProrationMethod(e.target.value as typeof prorationMethod)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            {PRORATION_METHODS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rounding rule</label>
          <select value={roundingRule} onChange={(e) => setRoundingRule(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="none">No rounding</option>
            <option value="nearest">Nearest whole number</option>
            <option value="up">Round up</option>
            <option value="down">Round down</option>
          </select>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Payroll Period</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payroll start day</label>
            <input type="number" min="1" max="31" value={payrollStartDay} onChange={(e) => setPayrollStartDay(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payroll end day</label>
            <input type="number" min="1" max="31" value={payrollEndDay} onChange={(e) => setPayrollEndDay(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <p className="mt-1 text-xs text-gray-500">31 means "last day of month".</p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Working Days</h3>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Working days calculation method</label>
          <select value={workingDaysMethod} onChange={(e) => setWorkingDaysMethod(e.target.value as typeof workingDaysMethod)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            {WORKING_DAYS_METHODS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Weekly holidays</label>
          <div className="flex gap-2">
            {WEEKDAYS.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(i)}
                className={`rounded px-2 py-1 text-xs border ${
                  weeklyHolidays.includes(i) ? "bg-[var(--color-primary)] text-white border-transparent" : "border-gray-300 text-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Public holidays (comma-separated YYYY-MM-DD)</label>
          <textarea value={publicHolidaysText} onChange={(e) => setPublicHolidaysText(e.target.value)} rows={2} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-green-600">Saved</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>
    </div>
  );
}
