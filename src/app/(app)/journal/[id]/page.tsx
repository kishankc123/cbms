import { notFound } from "next/navigation";
import { requireTenantSession, can } from "@/lib/session";
import { getJournalEntry } from "@/lib/ledger/journal-list";
import { loadReportHeader } from "@/lib/report-header";
import { formatDate, formatDateTime } from "@/lib/calendar";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { BackButton } from "@/components/ui/back-button";
import { VoucherPrint } from "./voucher-print";

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TITLE = { posted: "Journal voucher", reversed: "Journal voucher (reversed)", reversal: "Journal voucher (reversal)" } as const;

export default async function JournalVoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  const { id } = await params;
  const entry = await getJournalEntry(session.tenantId, id);
  if (!entry) notFound();
  const header = await loadReportHeader(session.tenantId);
  const auto = (await searchParams).print === "1";
  const debit = entry.lines.reduce((s, l) => s + l.debit, 0);
  const credit = entry.lines.reduce((s, l) => s + l.credit, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <BackButton href="/journal" label="Back to Journal Entries" />
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Voucher {entry.voucher || "—"}</h1>
        </div>
        <VoucherPrint auto={auto} />
      </div>
      <div id="voucher">
      <ReportSheet>
        <ReportHeader {...header} title={TITLE[entry.state]} period={`${entry.voucher ? `${entry.voucher}  ·  ` : ""}${formatDate(entry.date, session.calendar, "long")}  ·  ${entry.source}`} />
        <p className="mb-3 text-[13px]">
          <span className="text-ink-2">Narration: </span>
          {entry.narration || "—"}
        </p>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line-strong text-left">
              <th className="px-2.5 py-1.5 font-medium">Account</th>
              <th className="px-2.5 py-1.5 font-medium">Line note</th>
              <th className="w-32 px-2.5 py-1.5 text-right font-medium">Debit</th>
              <th className="w-32 px-2.5 py-1.5 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i} className="border-b border-line">
                <td className="px-2.5 py-1">
                  {l.code} — {l.name}
                </td>
                <td className="px-2.5 py-1">{l.note}</td>
                <td className="px-2.5 py-1 text-right tabular-nums">{l.debit ? money.format(l.debit) : ""}</td>
                <td className="px-2.5 py-1 text-right tabular-nums">{l.credit ? money.format(l.credit) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line-strong font-medium">
              <td className="px-2.5 py-1.5" colSpan={2}>
                Total
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{money.format(debit)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{money.format(credit)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-2">
          Entered by {entry.enteredBy || "—"} on {formatDateTime(entry.enteredAt, session.calendar)}
        </p>
        <div className="mt-10 grid grid-cols-3 gap-8 text-xs text-ink-2">
          {["Prepared by", "Checked by", "Approved by"].map((x) => (
            <p key={x} className="border-t border-line-strong pt-1">
              {x}
            </p>
          ))}
        </div>
        <ReportFooter />
      </ReportSheet>
      </div>
      {/* Only the voucher prints, not the menu and the buttons around it. */}
      <style>{`@media print { body * { visibility: hidden; } #voucher, #voucher * { visibility: visible; } #voucher { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </div>
  );
}
