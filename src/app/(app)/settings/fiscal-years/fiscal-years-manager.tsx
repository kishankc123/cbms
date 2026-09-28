"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addFiscalYear, closeFiscalYear, reopenFiscalYear, type getFiscalYearsPageData } from "./actions";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";

type Data = Awaited<ReturnType<typeof getFiscalYearsPageData>>;
const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";

const STATUS_TONE = { open: "success", closed: "pending", reopened: "critical" } as const;
const STATUS_LABEL = { open: "Open", closed: "Closed", reopened: "Reopened" } as const;

export function FiscalYearsManager({ data, isAdmin }: { data: Data; isAdmin: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState(data.suggestedNext?.code ?? "");
  const [startDate, setStartDate] = useState(data.suggestedNext?.from ?? "");
  const [endDate, setEndDate] = useState(data.suggestedNext?.to ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  async function run(fn: () => Promise<unknown>, onOk?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      onOk?.();
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await run(
      () => addFiscalYear({ code, startDate, endDate }),
      () => {
        setMessage({ tone: "ok", text: `Fiscal year ${code} added.` });
        setCode("");
        setStartDate("");
        setEndDate("");
      }
    );
  }

  async function submitReopen(e: React.FormEvent) {
    e.preventDefault();
    if (!reopenTarget) return;
    await run(
      () => reopenFiscalYear({ fiscalYearId: reopenTarget, reason: reopenReason }),
      () => {
        setReopenTarget(null);
        setReopenReason("");
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Fiscal Year</th>
              <th className="px-4 py-2 font-medium">Start</th>
              <th className="px-4 py-2 font-medium">End</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {data.years.map((fy) => (
              <tr key={fy.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium text-gray-900">{fy.code}</td>
                <td className="px-4 py-2">
                  <D value={fy.startDate} />
                </td>
                <td className="px-4 py-2">
                  <D value={fy.endDate} />
                </td>
                <td className="px-4 py-2">
                  <StatusPill tone={STATUS_TONE[fy.status]}>{STATUS_LABEL[fy.status]}</StatusPill>
                  {fy.status === "reopened" && fy.reopenReason && <div className="mt-1 text-xs text-gray-500">{fy.reopenReason}</div>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {fy.status !== "closed" && (
                    <button type="button" disabled={busy} onClick={() => run(() => closeFiscalYear(fy.id))} className="text-xs text-gray-600 hover:underline disabled:opacity-50">
                      Close
                    </button>
                  )}
                  {fy.status === "closed" && isAdmin && (
                    <button type="button" disabled={busy} onClick={() => setReopenTarget(fy.id)} className="text-xs text-red-600 hover:underline disabled:opacity-50">
                      Reopen
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.years.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No fiscal years on record yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reopenTarget && (
        <form onSubmit={submitReopen} className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Reopen fiscal year</h3>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason (required)</label>
            <input required value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={`${inputCls} w-full`} placeholder="Correction of omitted purchase transaction" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50">
              Reopen
            </button>
            <button type="button" onClick={() => setReopenTarget(null)} className="text-sm text-gray-600 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      )}

      <form onSubmit={add} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Add fiscal year</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Code</label>
            <input required value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} w-28`} placeholder="2084/85" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start date</label>
            <DatePicker value={startDate} onChange={setStartDate} required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End date</label>
            <DatePicker value={endDate} onChange={setEndDate} required />
          </div>
          <button type="submit" disabled={busy} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50">
            {busy ? "Adding..." : "Add"}
          </button>
        </div>
        {data.suggestedNext && <p className="text-xs text-gray-500">Suggested next: {data.suggestedNext.code}, pre-filled above.</p>}
      </form>

      {message && <p className={`text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
