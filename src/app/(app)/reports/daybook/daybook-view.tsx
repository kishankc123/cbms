"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, FileText, Image as ImageIcon, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DatePicker } from "@/components/calendar/date-picker";
import { daybookSheets, exportFileName, formatMoney, sheetCsv, type DayExtras, type ExportContext } from "@/lib/ledger/daybook-export";
import { ON_CREDIT, type Daybook, type DocSection } from "@/lib/ledger/daybook-rules";
import type { DaybookPage } from "@/lib/ledger/daybook";
import { chequeStatusLabel } from "@/lib/ledger/daybook-cheques";
import { CashCount, type CountAccount } from "./cash-count";
import { saveBlob } from "./daybook-image";
import { ImagePreview } from "./image-preview";
import { resolveSourceLink } from "@/lib/ledger/source-link";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";
const card = "rounded-lg border border-line bg-surface p-4";

export function ModeCard({ title, section, month }: { title: string; section: DocSection; month?: number }) {
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
              <td className={month === undefined ? "px-2.5 py-1.5" : td}>Total</td>
              <td className={`tnum text-right ${month === undefined ? "px-2.5 py-1.5" : td}`}>{formatMoney(section.total)}</td>
            </tr>
            {month !== undefined && (
              <tr className="text-ink-2">
                <td className="px-2.5 py-1.5">This month</td>
                <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(month)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Figure({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="border-l border-line px-4 py-2.5 first:border-l-0 first:pl-0">
      <p className="text-xs text-ink-2">{label}</p>
      <p className={`tnum mt-0.5 text-lg font-semibold leading-6 ${tone === "good" ? "text-[var(--success-text)]" : tone === "bad" ? "text-[var(--danger-text)]" : "text-ink"}`}>{formatMoney(value)}</p>
    </div>
  );
}

export function DaybookView({ page, countAccounts, canCount, monthLabel, cashCount, info, day, today, prevDay, nextDay }: { page: DaybookPage; countAccounts: CountAccount[]; canCount: boolean; monthLabel: string; cashCount: { counted: number; books: number } | null; info: ExportContext; day: string; today: string; prevDay: string; nextDay: string | null }) {
  const data = page.book;
  const extras: DayExtras = useMemo(() => ({ monthLabel, month: page.month, flows: page.flows, credit: page.credit, cashCount, cheques: page.cheques }), [monthLabel, page, cashCount]);
  const [preview, setPreview] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const go = (iso: string) => router.push(`/reports/daybook?date=${iso}`);

  async function excel() {
    setBusy("excel");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      for (const s of daybookSheets(data, info, page.list, page.cheques, extras)) {
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
    const text = daybookSheets(data, info, page.list, page.cheques, extras).map((s) => sheetCsv(s.rows)).join("\n\n");
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
          <Link href="/reports/daybook/range" className={buttonClass({ size: "sm" })}>
            Several days
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<ImageIcon size={15} />} onClick={() => setPreview(true)}>
            View image
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
          <ModeCard title="Sales" section={data.sales} month={page.month.sales} />
          <ModeCard title="Purchases" section={data.purchases} month={page.month.purchases} />
          <ModeCard title="Expenses" section={data.expenses} month={page.month.expenses} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className={`${card} lg:col-span-2`}>
            <h2 className="text-sm font-semibold text-ink">Collections and payments</h2>
            <p className="mb-2 text-xs text-ink-2">Month so far is from {monthLabel}.</p>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className={th}></th>
                  <th className={`${th} text-right`}>Today</th>
                  <th className={`${th} text-right`}>This month</th>
                </tr>
              </thead>
              <tbody>
                {page.flows.map((r) => (
                  <tr key={r.key}>
                    <td className={td}>{r.label}</td>
                    <td className={`${td} tnum text-right ${r.today > 0 ? "" : "text-ink-2"}`}>{r.today > 0 ? formatMoney(r.today) : "-"}</td>
                    <td className={`${td} tnum text-right`}>{formatMoney(r.month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-2">Money collected or paid together with a sale or bill on the same day is in that sale or bill, not here.</p>
          </section>
          <section className={card}>
            <h2 className="mb-2 text-sm font-semibold text-ink">Credit today</h2>
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                <tr>
                  <td className={td}>Given to customers</td>
                  <td className={`${td} tnum text-right`}>{formatMoney(page.credit.given)}</td>
                </tr>
                <tr>
                  <td className="px-2.5 py-1.5">Taken from suppliers</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{formatMoney(page.credit.taken)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-2">Sold, bought or spent today and not paid yet. Money collected or paid later is on the days it moved.</p>
          </section>
        </div>

        <section className={card}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">Cash and bank</h2>
            <Link href="/bank-reconciliation" className="text-xs text-accent-text hover:underline print:hidden">
              Reconcile bank
            </Link>
          </div>
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
          <p className="mt-2 text-xs text-ink-2">This month: money in {formatMoney(page.month.moneyIn)} · money out {formatMoney(page.month.moneyOut)}</p>
          {data.transfersMoved > 0 && <p className="mt-2 text-xs text-ink-2">{formatMoney(data.transfersMoved)} was moved between your own accounts. It is not money in or out.</p>}
        </section>

        <div className="print:hidden">
          <CashCount day={day} accounts={countAccounts} canEdit={canCount} />
        </div>

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

        {page.cheques.any && (
          <section className={card}>
            <h2 className="mb-1 text-sm font-semibold text-ink">Cheques</h2>
            <p className="mb-2 text-xs text-ink-2">Cheques are not in the figures above until the bank pays them.</p>
            <div className="space-y-4">
              {page.cheques.groups.map((g) => (
                <div key={g.key}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[13px] font-medium text-ink">{g.label}</h3>
                    <span className="text-xs text-ink-2">
                      {g.issued > 0 && `We give ${formatMoney(g.issued)}`}
                      {g.issued > 0 && g.received > 0 && " · "}
                      {g.received > 0 && `We get ${formatMoney(g.received)}`}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.kind + r.id}>
                            <td className={`${td} whitespace-nowrap text-ink-2`}>{r.kind === "issued" ? "We give" : "We get"}</td>
                            <td className={td}>{r.number}</td>
                            <td className={td}>{r.party}</td>
                            <td className={`${td} whitespace-nowrap text-ink-2`}>{chequeStatusLabel(r, today)}</td>
                            <td className={`${td} tnum text-right`}>{formatMoney(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="daybook-entries" className={`${card} scroll-mt-4`}>
          <h2 className="mb-1 text-sm font-semibold text-ink">Entries of the day</h2>
          <p className="mb-2 text-xs text-ink-2 print:hidden">Open an entry to correct it. When you come back, the figures and the picture show the change.</p>
          {page.list.length === 0 ? (
            <p className="text-[13px] text-ink-2">Nothing was entered on this day.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-left">
                    <th className={th}>Time</th>
                    <th className={th}>What</th>
                    <th className={th}>Reference</th>
                    <th className={th}>Note</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={`${th} print:hidden`}></th>
                  </tr>
                </thead>
                <tbody>
                  {page.list.map((r) => (
                    <tr key={r.id} className={r.correction ? "text-ink-2" : ""}>
                      <td className={`${td} whitespace-nowrap text-ink-2`}>
                        <span suppressHydrationWarning>{new Date(r.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </td>
                      <td className={td}>
                        {r.kind}
                        {r.correction && <span className="ml-1.5 text-xs">(correction)</span>}
                      </td>
                      <td className={td}>{r.reference}</td>
                      <td className={`${td} max-w-[280px] truncate`}>{r.note}</td>
                      <td className={`${td} tnum text-right`}>{formatMoney(r.amount)}</td>
                      <td className={`${td} whitespace-nowrap text-right print:hidden`}>
                        {(() => {
                          const link = resolveSourceLink(r.sourceType);
                          return link ? (
                            <Link href={link.href} className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline" title={link.label}>
                              Open <ExternalLink size={12} />
                            </Link>
                          ) : null;
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page.listHidden > 0 && <p className="mt-2 text-xs text-ink-2">{page.listHidden} more entries are not listed here. Use Excel or CSV from a narrower report if you need them.</p>}
        </section>
      </div>
      {preview && (
        <ImagePreview
          data={data}
          info={info}
          extras={extras}
          day={day}
          refreshing={refreshing}
          onRefresh={() => startRefresh(() => router.refresh())}
          onCheck={() => {
            setPreview(false);
            setTimeout(() => document.getElementById("daybook-entries")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
          }}
          onClose={() => setPreview(false)}
        />
      )}
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
