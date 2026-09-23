"use client";

import { useEffect, useMemo, useState } from "react";
import { DatePicker } from "@/components/calendar/date-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { calculatePenalty, type ExcisePenaltyParams, type TaxTypeKey, type TdsPenaltyParams, type VatPenaltyParams } from "@/lib/compliance/penalty-engine";
import { filingDueDate, formatDate, isoFromYmd, monthNames, todayIso, ymdOf, type CalendarSystem, type IsoDate } from "@/lib/calendar";
import { getPenaltyRuleForPreview, recordPenaltyCharge } from "./actions";

type TaxTypeOption = { key: string; name: string };
type Props = { calendar: CalendarSystem; taxTypes: TaxTypeOption[]; canRecord: boolean };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatThousands(raw: string): string {
  const clean = raw.replace(/[^\d.]/g, "");
  const [intPart, dec] = clean.split(".");
  const withCommas = (intPart || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

export function PenaltyCalculator({ calendar, taxTypes, canRecord }: Props) {
  const [taxTypeKey, setTaxTypeKey] = useState<TaxTypeKey>((taxTypes[0]?.key as TaxTypeKey) ?? "vat");
  const today = todayIso();
  const todayYmd = ymdOf(calendar, today)!;

  const [periodYear, setPeriodYear] = useState(todayYmd.year);
  const [periodMonth, setPeriodMonth] = useState(todayYmd.month);
  const [actualDate, setActualDate] = useState<IsoDate>(today);
  const [principalText, setPrincipalText] = useState("");
  const [manualOverrideText, setManualOverrideText] = useState("");

  const periodAnchor = isoFromYmd(calendar, { year: periodYear, month: periodMonth, day: 1 }) ?? today;
  const periodLabel = `${monthNames(calendar)[periodMonth - 1]} ${periodYear}`;
  const dueDate = filingDueDate(calendar, periodAnchor);
  const principal = Number(principalText.replace(/,/g, "")) || 0;
  const manualOverride = taxTypeKey === "excise" && manualOverrideText.trim() !== "" ? Number(manualOverrideText.replace(/,/g, "")) || 0 : null;

  const [rule, setRule] = useState<{ params: Record<string, number>; isVerified: boolean; source: string | null } | null | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRule(undefined);
    getPenaltyRuleForPreview(taxTypeKey, dueDate)
      .then((r) => !cancelled && setRule(r))
      .catch(() => !cancelled && setRule(null));
    return () => {
      cancelled = true;
    };
  }, [taxTypeKey, dueDate]);

  const breakdown = useMemo(() => {
    if (!rule) return null;
    return calculatePenalty(taxTypeKey, principal, dueDate, actualDate, rule.params as VatPenaltyParams | TdsPenaltyParams | ExcisePenaltyParams, manualOverride);
  }, [rule, taxTypeKey, principal, dueDate, actualDate, manualOverride]);

  async function handleRecord() {
    if (!breakdown) return;
    setError(null);
    setRecording(true);
    try {
      await recordPenaltyCharge({
        taxTypeKey,
        periodLabel,
        dueDate,
        actualDate,
        penaltyAmount: breakdown.filingPenalty + breakdown.paymentPenalty,
        interestAmount: breakdown.interest,
      });
      setRecorded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record this charge");
    } finally {
      setRecording(false);
    }
  }

  const [minYear, maxYear] = calendar === "BS" ? [2075, 2090] : [2020, 2035];
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  const floorApplied = taxTypeKey === "vat" && breakdown && breakdown.lines.some((l) => l.label === "Applied filing penalty" && l.note === "Minimum floor rate applied");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-3 gap-3">
          {taxTypes.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTaxTypeKey(t.key as TaxTypeKey);
                setRecorded(false);
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                taxTypeKey === t.key ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Period ({calendar})</label>
          <div className="flex gap-2">
            <select
              value={periodMonth}
              onChange={(e) => {
                setPeriodMonth(+e.target.value);
                setRecorded(false);
              }}
              className="flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {monthNames(calendar).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={periodYear}
              onChange={(e) => {
                setPeriodYear(+e.target.value);
                setRecorded(false);
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Statutory due date</label>
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-700">{formatDate(dueDate, calendar)}</div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Actual filing / payment date</label>
            <DatePicker value={actualDate} onChange={(v) => { setActualDate(v); setRecorded(false); }} calendar={calendar} />
          </div>
        </div>

        {breakdown && (
          <div>
            {breakdown.daysDelayed === 0 ? (
              <StatusPill tone="success">On time — no charge</StatusPill>
            ) : (
              <StatusPill tone="critical">{breakdown.daysDelayed} day{breakdown.daysDelayed === 1 ? "" : "s"} delayed</StatusPill>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">{taxTypeKey === "vat" ? "VAT payable for the period" : taxTypeKey === "tds" ? "TDS withheld for the period" : "Excise duty for the period"}</label>
          <input
            type="text"
            inputMode="decimal"
            value={principalText}
            onChange={(e) => {
              setPrincipalText(formatThousands(e.target.value));
              setRecorded(false);
            }}
            placeholder="0.00"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
          />
        </div>

        {taxTypeKey === "excise" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Manual filing / audit penalty (from the department&apos;s order, if any)</label>
            <input
              type="text"
              inputMode="decimal"
              value={manualOverrideText}
              onChange={(e) => {
                setManualOverrideText(formatThousands(e.target.value));
                setRecorded(false);
              }}
              placeholder="0.00"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </div>
        )}

        {rule && !rule.isVerified && (
          <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">These rates have not yet been confirmed by a compliance reviewer against current law.</p>
        )}
        {rule === null && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">No penalty rule is configured for {taxTypeKey.toUpperCase()} yet.</p>}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Breakdown</h3>
        {!breakdown && <p className="text-sm text-gray-400">Enter the period and amount to calculate.</p>}
        {breakdown && (
          <>
            <dl className="divide-y divide-gray-100 text-sm">
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-gray-500">Principal</dt>
                <dd className="font-medium text-gray-900">{fmt(breakdown.principal)}</dd>
              </div>
              {breakdown.lines.map((l, i) => (
                <div key={i} className="flex items-start justify-between py-1.5">
                  <dt className="text-gray-500">
                    {l.label}
                    {l.note && (
                      <span className="ml-1.5 text-xs text-gray-400" title={l.note}>
                        ({l.note})
                      </span>
                    )}
                  </dt>
                  <dd className="font-medium text-gray-900">{fmt(l.amount)}</dd>
                </div>
              ))}
            </dl>
            {floorApplied && <StatusPill tone="pending">Minimum floor rate applied</StatusPill>}
            <div className="flex items-center justify-between border-t border-gray-200 pt-3 text-base">
              <span className="font-semibold text-gray-900">Total payable</span>
              <span className="font-bold text-gray-900">{fmt(breakdown.totalPayable)}</span>
            </div>

            {canRecord && (
              <div className="pt-2">
                {recorded ? (
                  <StatusPill tone="success">Recorded — posted to the ledger</StatusPill>
                ) : (
                  <button
                    type="button"
                    disabled={recording || breakdown.daysDelayed === 0 || (breakdown.filingPenalty + breakdown.paymentPenalty + breakdown.interest) <= 0}
                    onClick={handleRecord}
                    className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {recording ? "Recording…" : "Record this charge"}
                  </button>
                )}
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
