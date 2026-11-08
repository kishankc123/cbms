"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DatePicker } from "@/components/calendar/date-picker";
import { formatDate, weekdayOf, type CalendarSystem } from "@/lib/calendar";
import { exportFileName, formatMoney, rangeSheets, sheetCsv, type ExportContext } from "@/lib/ledger/daybook-export";
import type { DaybookRange } from "@/lib/ledger/daybook-range";
import { saveBlob } from "../daybook-image";
import { Figure, ModeCard } from "../daybook-view";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";
const card = "rounded-lg border border-line bg-surface p-4";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RangeView({ data, info, today, presets, trimmed, calendar }: { data: DaybookRange; info: ExportContext; today: string; presets: { label: string; from: string; to: string }[]; trimmed: boolean; calendar: CalendarSystem }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = (from: string, to: string) => router.push(`/reports/daybook/range?from=${from}&to=${to}`);
  const t = data.total;
  const label = (iso: string) => formatDate(iso, calendar, "long");
  const file = (ext: string) => exportFileName(info.company, `${data.from}_to_${data.to}`, ext);

  async function excel() {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      for (const s of rangeSheets(data, info, label)) {
        const ws = XLSX.utils.aoa_to_sheet(s.rows);
        ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, ws, s.name);
      }
      XLSX.writeFile(wb, file("xlsx"));
    } catch {
      toast.error("Couldn't make the spreadsheet. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function csv() {
    saveBlob(new Blob(["﻿" + rangeSheets(data, info, label).map((s) => sheetCsv(s.rows)).join("\n\n")], { type: "text/csv;charset=utf-8" }), file("csv"));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <DatePicker value={data.from} onChange={(iso) => iso && go(iso, iso > data.to ? iso : data.to)} max={today} />
          </div>
          <span className="text-sm text-ink-2">to</span>
          <div className="w-44">
            <DatePicker value={data.to} onChange={(iso) => iso && go(iso < data.from ? iso : data.from, iso)} max={today} />
          </div>
          <Link href={`/reports/daybook?date=${data.to}`} className={buttonClass({ size: "sm" })}>
            One day
          </Link>
          {presets.map((p) => (
            <Link key={p.label} href={`/reports/daybook/range?from=${p.from}&to=${p.to}`} className={buttonClass({ size: "sm" })}>
              {p.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<FileSpreadsheet size={15} />} loading={busy} onClick={excel}>
            Excel
          </Button>
          <Button size="sm" icon={<FileText size={15} />} onClick={csv}>
            CSV
          </Button>
          <Button size="sm" icon={<Printer size={15} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      <div id="daybook" className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{info.dateLabel}</h2>
          <p className="text-xs text-ink-2">
            {data.days.length} {data.days.length === 1 ? "day" : "days"} · {info.company}
          </p>
        </div>
        {trimmed && <p className="rounded-md border border-line bg-app px-3 py-2 text-sm text-ink-2">Only the last {data.days.length} days up to the end date are shown. Pick a shorter period to see earlier days.</p>}
        {!t.reconciles && <p className="rounded-md border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2 text-sm text-[var(--status-critical-text)]">The closing balances don&apos;t match the ledger for one of your accounts. Please tell support: this should not happen.</p>}

        <div className="flex flex-wrap border-y border-line">
          <Figure label="Sales" value={t.sales.total} />
          <Figure label="Purchases" value={t.purchases.total} />
          <Figure label="Expenses" value={t.expenses.total} />
          <Figure label="Money in" value={t.moneyIn} tone="good" />
          <Figure label="Money out" value={t.moneyOut} tone="bad" />
          <Figure label="Net" value={t.net} />
        </div>
        {data.busiest && (
          <p className="text-xs text-ink-2">
            Best sales day: {label(data.busiest.day)}, {formatMoney(data.busiest.sales)}. Cash and bank went from {formatMoney(t.totals.opening)} to {formatMoney(t.totals.closing)}.
          </p>
        )}

        <section className={card}>
          <h2 className="mb-2 text-sm font-semibold text-ink">Day by day</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className={th}>Date</th>
                  <th className={`${th} text-right`}>Sales</th>
                  <th className={`${th} text-right`}>Purchases</th>
                  <th className={`${th} text-right`}>Expenses</th>
                  <th className={`${th} text-right`}>Money in</th>
                  <th className={`${th} text-right`}>Money out</th>
                  <th className={`${th} text-right`}>Cash and bank at close</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day} className={d.quiet ? "text-ink-2" : ""}>
                    <td className={`${td} whitespace-nowrap`}>
                      <Link href={`/reports/daybook?date=${d.day}`} className="hover:underline">
                        {WEEKDAYS[weekdayOf(d.day)]} {label(d.day)}
                      </Link>
                    </td>
                    <td className={`${td} tnum text-right`}>{d.quiet ? "" : formatMoney(d.sales)}</td>
                    <td className={`${td} tnum text-right`}>{d.quiet ? "" : formatMoney(d.purchases)}</td>
                    <td className={`${td} tnum text-right`}>{d.quiet ? "" : formatMoney(d.expenses)}</td>
                    <td className={`${td} tnum text-right`}>{d.quiet ? "" : formatMoney(d.moneyIn)}</td>
                    <td className={`${td} tnum text-right`}>{d.quiet ? "" : formatMoney(d.moneyOut)}</td>
                    <td className={`${td} tnum text-right`}>{formatMoney(d.closing)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-2.5 py-1.5">Total</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(t.sales.total)}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(t.purchases.total)}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(t.expenses.total)}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(t.moneyIn)}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(t.moneyOut)}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(t.totals.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ModeCard title="Sales" section={t.sales} />
          <ModeCard title="Purchases" section={t.purchases} />
          <ModeCard title="Expenses" section={t.expenses} />
        </div>

        {t.other.length > 0 && (
          <section className={card}>
            <h2 className="mb-2 text-sm font-semibold text-ink">Other money movements</h2>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className={th}>What</th>
                  <th className={`${th} text-right`}>In</th>
                  <th className={`${th} text-right`}>Out</th>
                </tr>
              </thead>
              <tbody>
                {t.other.map((o) => (
                  <tr key={o.key}>
                    <td className={td}>{o.label}</td>
                    <td className={`${td} tnum text-right`}>{o.in > 0 ? formatMoney(o.in) : ""}</td>
                    <td className={`${td} tnum text-right`}>{o.out > 0 ? formatMoney(o.out) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
      <style>{`@media print { body * { visibility: hidden; } #daybook, #daybook * { visibility: visible; } #daybook { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </div>
  );
}
