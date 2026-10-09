"use client";

import { useRef, useState } from "react";
import { getVatPeriodDetailsView } from "./vat-worksheet-actions";
import type { VatPeriodDetails, VatDetailLine } from "@/lib/compliance/vat-period-details";
import type { VatWorksheetRow } from "@/lib/compliance/vat-worksheet";
import { PeriodLabel, D } from "@/components/calendar/date-text";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND: Record<VatDetailLine["kind"], string> = {
  sale: "Sale",
  asset_sale: "Asset sale",
  sales_return: "Sales return",
  purchase: "Purchase",
  expense: "Expense",
  purchase_return: "Purchase return",
};

function Section({ title, lines, taxable, vat, partyLabel }: { title: string; lines: VatDetailLine[]; taxable: number; vat: number; partyLabel: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-1 pr-2 font-medium">Date</th>
            <th className="py-1 pr-2 font-medium">Type</th>
            <th className="py-1 pr-2 font-medium">Number</th>
            <th className="py-1 pr-2 font-medium">{partyLabel}</th>
            <th className="py-1 pr-2 text-right font-medium">Taxable amount</th>
            <th className="py-1 text-right font-medium">VAT</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={6} className="py-2 text-center text-gray-400">
                None in this month
              </td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={i} className={`border-b border-gray-100 ${l.taxable < 0 ? "text-red-700" : "text-gray-800"}`}>
              <td className="whitespace-nowrap py-1 pr-2">
                <D value={l.date} />
              </td>
              <td className="whitespace-nowrap py-1 pr-2">{KIND[l.kind]}</td>
              <td className="py-1 pr-2">{l.number}</td>
              <td className="py-1 pr-2">{l.party}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{fmt(l.taxable)}</td>
              <td className="py-1 text-right tabular-nums">{fmt(l.vat)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-gray-900">
            <td colSpan={4} className="py-1 pr-2">
              Net total
            </td>
            <td className="py-1 pr-2 text-right tabular-nums">{fmt(taxable)}</td>
            <td className="py-1 text-right tabular-nums">{fmt(vat)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * The month label of a worksheet row. Hovering (or focusing / clicking) it opens a panel with the documents behind the month's Net
 * sales and Net purchase. The panel is read live from the books, so if it no longer agrees with the saved figures it says so.
 */
export function VatPeriodHover({ row }: { row: VatWorksheetRow }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<VatPeriodDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) {
        const width = Math.min(780, window.innerWidth - 16);
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        const spaceBelow = window.innerHeight - r.bottom - 12;
        // Open downwards when there is room, otherwise upwards.
        setBox(spaceBelow >= 260 ? { left, top: r.bottom, maxHeight: spaceBelow } : { left, bottom: window.innerHeight - r.top, maxHeight: Math.max(220, r.top - 12) });
      }
      setOpen(true);
      if (!details && !error) {
        getVatPeriodDetailsView(row.obligationId)
          .then(setDetails)
          .catch((e) => setError(e instanceof Error ? e.message : "Could not load the details"));
      }
    }, 250);
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  }

  const differs = details && (Math.abs(details.salesTaxable - row.netSales) > 0.005 || Math.abs(details.salesVat - row.salesVat) > 0.005 || Math.abs(details.purchasesTaxable - row.netPurchase) > 0.005 || Math.abs(details.purchasesVat - row.purchaseVat) > 0.005);

  return (
    <span ref={anchor} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show} tabIndex={0} className="cursor-help underline decoration-dotted decoration-gray-400 underline-offset-4 outline-none focus:text-[var(--color-primary)]">
      <PeriodLabel start={row.periodStart} end={row.periodEnd} fallback={row.periodLabel} />
      {open && box && (
        <span
          style={{ position: "fixed", left: box.left, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight, width: Math.min(780, typeof window === "undefined" ? 780 : window.innerWidth - 16) }}
          className="z-50 block cursor-default space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-left text-sm font-normal text-gray-900 no-underline shadow-xl"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <span className="block text-sm font-semibold">
            <PeriodLabel start={row.periodStart} end={row.periodEnd} fallback={row.periodLabel} /> — what the figures are made of
          </span>
          {error && <span className="block text-red-600">{error}</span>}
          {!details && !error && <span className="block text-gray-400">Loading…</span>}
          {details && (
            <>
              {differs && <span className="block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">The books have changed since this worksheet was saved. These are the current documents; the worksheet still shows the saved figures.</span>}
              <Section title="Net sales (sales less sales returns)" lines={details.sales} taxable={details.salesTaxable} vat={details.salesVat} partyLabel="Customer" />
              <Section title="Net purchase (purchases and expenses less purchase returns)" lines={details.purchases} taxable={details.purchasesTaxable} vat={details.purchasesVat} partyLabel="Supplier" />
            </>
          )}
        </span>
      )}
    </span>
  );
}
