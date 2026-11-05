"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, controlClass } from "@/components/ui/field";
import { DatePicker } from "@/components/calendar/date-picker";
import type { ReportTable } from "@/lib/payroll/payroll-reports";

type Years = { startYear: number; label: string }[];
type Current = { report: string; fy: string; from: string; to: string; employee: string };

// The filters for a report. They live in the address, so a filtered report can be bookmarked or shared.
export function ReportFilters({ years, employees, current, usesRange }: { years: Years; employees: { id: string; name: string }[]; current: Current; usesRange: boolean }) {
  const router = useRouter();
  const go = (patch: Partial<Current>) => {
    const next = { ...current, ...patch };
    const q = new URLSearchParams();
    q.set("report", next.report);
    // Choosing a fiscal year clears a custom range, and a custom range clears the fiscal year: only one of them decides the dates.
    if (next.from || next.to) {
      if (next.from) q.set("from", next.from);
      if (next.to) q.set("to", next.to);
    } else if (next.fy) q.set("fy", next.fy);
    if (next.employee) q.set("employee", next.employee);
    router.replace(`/payroll/reports?${q.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {usesRange && (
        <>
          <label className="text-xs text-ink-2">
            Fiscal year
            <Select className="mt-1 w-40" value={current.from || current.to ? "" : current.fy} onChange={(e) => go({ fy: e.target.value, from: "", to: "" })}>
              <option value="">Custom dates</option>
              {years.map((y) => (
                <option key={y.startYear} value={String(y.startYear)}>
                  {y.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-ink-2">
            From
            <DatePicker value={current.from} onChange={(v) => go({ from: v, fy: "" })} className={`${controlClass} mt-1 w-40`} />
          </label>
          <label className="text-xs text-ink-2">
            To
            <DatePicker value={current.to} onChange={(v) => go({ to: v, fy: "" })} className={`${controlClass} mt-1 w-40`} />
          </label>
          <label className="text-xs text-ink-2">
            Employee
            <Select className="mt-1 w-52" value={current.employee} onChange={(e) => go({ employee: e.target.value })}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </label>
        </>
      )}
    </div>
  );
}

export function ReportActions({ table, title, filename, extra }: { table: ReportTable; title: string; filename: string; /** A second table for a second sheet in the workbook. */ extra?: { title: string; table: ReportTable } }) {
  async function exportExcel() {
    const XLSX = await import("xlsx");
    const header = table.columns.map((c) => c.label);
    const body = table.rows.map((r) => table.columns.map((c) => r[c.key] ?? ""));
    const totals = table.totals ? [table.columns.map((c) => table.totals?.[c.key] ?? "")] : [];
    const sheet = XLSX.utils.aoa_to_sheet([[title], [], header, ...body, ...totals]);
    sheet["!cols"] = table.columns.map((c) => ({ wch: Math.max(c.label.length + 2, c.numeric ? 14 : 22) }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, title.slice(0, 31));
    if (extra) {
      const second = XLSX.utils.aoa_to_sheet([[extra.title], [], extra.table.columns.map((c) => c.label), ...extra.table.rows.map((r) => extra.table.columns.map((c) => r[c.key] ?? "")), ...(extra.table.totals ? [extra.table.columns.map((c) => extra.table.totals?.[c.key] ?? "")] : [])]);
      second["!cols"] = extra.table.columns.map((c) => ({ wch: Math.max(c.label.length + 2, c.numeric ? 14 : 22) }));
      XLSX.utils.book_append_sheet(book, second, extra.title.slice(0, 31));
    }
    XLSX.writeFile(book, `${filename}.xlsx`);
  }
  return (
    <div className="flex gap-2 print:hidden">
      <Button onClick={exportExcel}>Export to Excel</Button>
      <Button onClick={() => window.print()}>Print / save as PDF</Button>
    </div>
  );
}
