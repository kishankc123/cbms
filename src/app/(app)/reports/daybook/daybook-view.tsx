"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, FileSpreadsheet, FileText, Image as ImageIcon, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DatePicker } from "@/components/calendar/date-picker";
import { daybookSheets, exportFileName, formatMoney, sheetCsv, type ExportContext } from "@/lib/ledger/daybook-export";
import { ON_CREDIT, type Daybook, type DocSection } from "@/lib/ledger/daybook-rules";
import { canvasToBlob, drawDaybookImage, saveBlob } from "./daybook-image";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";
const card = "rounded-lg border border-line bg-surface p-4";

function ModeCard({ title, section }: { title: string; section: DocSection }) {
  return (
    <section className={card}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="text-xs text-ink-2">{section.count} {section.count === 1 ? "entry" : "entries"}</span>
      </div>
      {section.byMode.length === 0 ? (
        <p className="py-1 text-[13px] text-ink-2">Nothing today.</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {section.byMode.map((m) => (
              <tr key={m.mode}>
                <td className={`${td} ${m.mode === ON_CREDIT ? "text-ink-2" : "text-ink"}`}>{m.mode}</td>
                <td className={`${td} tnum text-right ${m.mode === ON_CREDIT ? "text-ink-2" : ""}`}>{formatMoney(m.amount)}</td>
              </tr>
            ))}
            {section.returns > 0 && (
              <tr>
                <td className={`${td} text-ink-2`}>Returns</td>
                <td className={`${td} tnum text-right text-ink-2`}>-{formatMoney(section.returns)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td className="px-2.5 py-1.5">Total</td>
              <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(section.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="border-l border-line px-4 py-2.5 first:border-l-0 first:pl-0">
      <p className="text-xs text-ink-2">{label}</p>
      <p className={`tnum mt-0.5 text-lg font-semibold leading-6 ${tone === "good" ? "text-[var(--success-text)]" : tone === "bad" ? "text-[var(--danger-text)]" : "text-ink"}`}>{formatMoney(value)}</p>
    </div>
  );
}

export function DaybookView({ data, info, day, today, prevDay, nextDay }: { data: Daybook; info: ExportContext; day: string; today: string; prevDay: string; nextDay: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const go = (iso: string) => router.push(`/reports/daybook?date=${iso}`);

  async function image(copy: boolean) {
    setBusy(copy ? "copy" : "image");
    try {
      const blob = await canvasToBlob(drawDaybookImage(data, info));
      if (copy) {
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("copy-unsupported");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast.success("Picture copied. Paste it into your chat.");
      } else {
        saveBlob(blob, exportFileName(info.company, day, "png"));
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message === "copy-unsupported" ? "This browser can't copy pictures. Download it instead." : "Couldn't make the picture. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function excel() {
    setBusy("excel");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      for (const s of daybookSheets(data, info)) {
        const ws = XLSX.utils.aoa_to_sheet(s.rows);
        ws["!cols"] = [{ wch: 38 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, ws, s.name);
      }
      XLSX.writeFile(wb, exportFileName(info.company, day, "xlsx"));
    } catch {
      toast.error("Couldn't make the spreadsheet. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function csv() {
    const text = daybookSheets(data, info).map((s) => sheetCsv(s.rows)).join("\n\n");
    saveBlob(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), exportFileName(info.company, day, "csv"));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/reports/daybook?date=${prevDay}`} aria-label="Previous day" className={buttonClass({ size: "sm" })}>
            <ChevronLeft size={16} />
          </Link>
          <div className="w-44">
            <DatePicker value={day} onChange={(iso) => iso && go(iso)} max={today} />
          </div>
          {nextDay ? (
            <Link href={`/reports/daybook?date=${nextDay}`} aria-label="Next day" className={buttonClass({ size: "sm" })}>
              <ChevronRight size={16} />
            </Link>
          ) : (
            <span aria-hidden className={`${buttonClass({ size: "sm" })} pointer-events-none opacity-40`}>
              <ChevronRight size={16} />
            </span>
          )}
          {day !== today && (
            <Link href="/reports/daybook" className={buttonClass({ size: "sm" })}>
              Today
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<ImageIcon size={15} />} loading={busy === "image"} onClick={() => image(false)}>
            Download image
          </Button>
          <Button size="sm" icon={<Copy size={15} />} loading={busy === "copy"} onClick={() => image(true)}>
            Copy image
          </Button>
          <Button size="sm" icon={<FileSpreadsheet size={15} />} loading={busy === "excel"} onClick={excel}>
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
            {info.otherDateLabel} · {info.company}
          </p>
        </div>

        {!data.reconciles && <p className="rounded-md border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2 text-sm text-[var(--status-critical-text)]">The closing balances don&apos;t match the ledger for one of your accounts. Please tell support: this should not happen.</p>}

        <div className="flex flex-wrap border-y border-line">
          <Figure label="Sales" value={data.sales.total} />
          <Figure label="Purchases" value={data.purchases.total} />
          <Figure label="Expenses" value={data.expenses.total} />
          <Figure label="Money in" value={data.moneyIn} tone="good" />
          <Figure label="Money out" value={data.moneyOut} tone="bad" />
          <Figure label="Net" value={data.net} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ModeCard title="Sales" section={data.sales} />
          <ModeCard title="Purchases" section={data.purchases} />
          <ModeCard title="Expenses" section={data.expenses} />
        </div>

        <section className={card}>
          <h2 className="mb-2 text-sm font-semibold text-ink">Cash and bank</h2>
          {data.accounts.length === 0 ? (
            <p className="text-[13px] text-ink-2">No cash or bank accounts have a balance or any activity.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-left">
                    <th className={th}>Account</th>
                    <th className={`${th} text-right`}>Opening</th>
                    <th className={`${th} text-right`}>In</th>
                    <th className={`${th} text-right`}>Out</th>
                    <th className={`${th} text-right`} title="Moved between your own accounts">Moved</th>
                    <th className={`${th} text-right`}>Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <GroupRows key={g.group} group={g} accounts={data.accounts.filter((a) => a.group === g.group)} />
                  ))}
                  <tr className="font-semibold">
                    <td className="px-2.5 py-1.5">Total</td>
                    <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(data.totals.opening)}</td>
                    <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(data.totals.in)}</td>
                    <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(data.totals.out)}</td>
                    <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(data.totals.transfers)}</td>
                    <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(data.totals.closing)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {data.transfersMoved > 0 && <p className="mt-2 text-xs text-ink-2">{formatMoney(data.transfersMoved)} was moved between your own accounts. It is not money in or out.</p>}
        </section>

        {data.other.length > 0 && (
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
                {data.other.map((o) => (
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

function GroupRows({ group, accounts }: { group: Daybook["groups"][number]; accounts: Daybook["accounts"] }) {
  return (
    <>
      <tr className="bg-app font-medium">
        <td className="px-2.5 py-1.5">{group.label}</td>
        <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(group.opening)}</td>
        <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(group.in)}</td>
        <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(group.out)}</td>
        <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(group.transfers)}</td>
        <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(group.closing)}</td>
      </tr>
      {accounts.length > 1 &&
        accounts.map((a) => (
          <tr key={a.accountId} className="text-ink-2">
            <td className="border-b border-line py-1.5 pl-6 pr-2.5">{a.name}</td>
            <td className="tnum border-b border-line px-2.5 py-1.5 text-right">{formatMoney(a.opening)}</td>
            <td className="tnum border-b border-line px-2.5 py-1.5 text-right">{formatMoney(a.in)}</td>
            <td className="tnum border-b border-line px-2.5 py-1.5 text-right">{formatMoney(a.out)}</td>
            <td className="tnum border-b border-line px-2.5 py-1.5 text-right">{formatMoney(a.transfers)}</td>
            <td className="tnum border-b border-line px-2.5 py-1.5 text-right">{formatMoney(a.closing)}</td>
          </tr>
        ))}
    </>
  );
}
