"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { DatePicker } from "@/components/calendar/date-picker";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { formatDate } from "@/lib/calendar";
import { fiscalYearOfDate } from "@/lib/compliance/fiscal-year-of";
import { sheetTotals } from "@/lib/ledger/opening-ledger-rules";
import type { loadOpeningSheet } from "@/lib/ledger/opening-ledger";
import { settingsButton, settingsInput, settingsLabel } from "../ui";
import { saveOpeningBalances } from "./actions";

const money = (n: number) => (n === 0 ? "" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (text: string) => (text.trim() === "" ? 0 : Number(text.replace(/,/g, "")));
const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

type Sheet = Awaited<ReturnType<typeof loadOpeningSheet>>;
type Typed = { dr: string; cr: string };

export function OpeningBalancesForm({ sheet, canSave }: { sheet: Sheet; canSave: boolean }) {
  const router = useRouter();
  const calendar = useCalendar();
  const { report, dialog } = useProblem();
  const [date, setDate] = useState(sheet.date ?? "");
  const [typed, setTyped] = useState<Record<string, Typed>>(() =>
    Object.fromEntries(sheet.rows.filter((r) => !r.screen && r.net !== 0).map((r) => [r.id, r.net > 0 ? { dr: String(r.net), cr: "" } : { dr: "", cr: String(-r.net) }]))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fiscalYear = date ? fiscalYearOfDate(date) : null;

  // Net debit of every row as it stands now: typed for the editable rows, as posted for the ones their own screen enters.
  const nets = sheet.rows.map((r) => (r.screen ? r.net : num(typed[r.id]?.dr ?? "") - num(typed[r.id]?.cr ?? "")));
  const bad = sheet.rows.find((r, i) => !r.screen && !Number.isFinite(nets[i]));
  const totals = sheetTotals(nets);
  const difference = totals.debit - totals.credit; // what Brought forward holds so the books balance

  function type(id: string, side: keyof Typed, value: string) {
    setSaved(false);
    setTyped((t) => ({ ...t, [id]: side === "dr" ? { dr: value, cr: value ? "" : (t[id]?.cr ?? "") } : { cr: value, dr: value ? "" : (t[id]?.dr ?? "") } }));
  }

  async function save() {
    if (bad) return report(`The opening balance of ${bad.name} is not a number`, null);
    setSaving(true);
    try {
      await saveOpeningBalances({ date, netDebits: Object.fromEntries(sheet.rows.flatMap((r, i) => (r.screen || Math.abs(nets[i] - r.net) < 0.005 ? [] : [[r.id, nets[i]]]))) });
      setSaved(true);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the opening balances", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        <div className="w-48">
          <label className={settingsLabel}>Opening balance date</label>
          <DatePicker value={date} onChange={(v) => { setDate(v); setSaved(false); }} disabled={!canSave} className={settingsInput} />
        </div>
        <div>
          <p className={settingsLabel}>Fiscal year</p>
          <p className="py-1.5 text-sm">{fiscalYear?.label ?? "—"}</p>
        </div>
        <div>
          <p className={settingsLabel}>Fiscal year start date</p>
          <p className="py-1.5 text-sm">{fiscalYear ? formatDate(fiscalYear.from, calendar) : "—"}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        {canSave && (
          <div className="flex justify-end border-b border-[var(--card-border)] px-3 py-2">
            <button type="button" disabled={saving || !!bad || !date} onClick={save} className={`${settingsButton} disabled:opacity-50`}>
              {saving ? "Saving..." : saved ? "Saved" : "Save"}
            </button>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--surface-muted-bg)] text-left text-xs text-gray-500">
              <th className={`${th} w-12`}>SN</th>
              <th className={th}>Category</th>
              <th className={th}>Account</th>
              <th className={`${th} w-44 text-right`}>Debit</th>
              <th className={`${th} w-44 text-right`}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r, i) => (
              <tr key={r.id} className="border-t border-[var(--card-border)]">
                <td className={`${td} text-gray-400`}>{i + 1}</td>
                <td className={`${td} text-gray-500`}>{r.category}</td>
                <td className={td}>
                  <span className="mr-2 text-xs text-gray-400">{r.code}</span>
                  {r.name}
                  {r.screen && (
                    <Link href={r.screen} className="ml-3 text-xs text-[var(--color-primary)] hover:underline">
                      Enter on its own screen
                    </Link>
                  )}
                </td>
                {r.screen || !canSave ? (
                  <>
                    <td className={`${td} text-right`}>{money(Math.max(nets[i], 0))}</td>
                    <td className={`${td} text-right`}>{money(Math.max(-nets[i], 0))}</td>
                  </>
                ) : (
                  (["dr", "cr"] as const).map((s) => (
                    <td key={s} className={td}>
                      <input inputMode="decimal" value={typed[r.id]?.[s] ?? ""} onChange={(e) => type(r.id, s, e.target.value)} placeholder="0.00" className={`${settingsInput} text-right`} />
                    </td>
                  ))
                )}
              </tr>
            ))}
            <tr className="border-t border-[var(--card-border)] font-medium">
              <td className={td} colSpan={3}>
                Total
              </td>
              <td className={`${td} text-right`}>{money(totals.debit)}</td>
              <td className={`${td} text-right`}>{money(totals.credit)}</td>
            </tr>
            <tr className={`border-t border-[var(--card-border)] font-medium ${difference === 0 ? "text-green-700" : "text-amber-700"}`}>
              <td className={td} colSpan={3}>
                Difference (held in Brought forward)
              </td>
              <td className={`${td} text-right`}>{money(Math.max(-difference, 0))}</td>
              <td className={`${td} text-right`}>{money(Math.max(difference, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}
