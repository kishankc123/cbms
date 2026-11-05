import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { DEPOSIT_STATUS_LABEL, type DepositStatus, type TdsDepositPosition } from "@/lib/compliance/tds-deposit-rules";
import type { HeadFine } from "@/lib/compliance/tds-fines";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE: Record<DepositStatus, StatusTone> = { deposited: "success", part: "pending", none: "action", no_item: "critical" };

/** The fine and interest figure, with what it is made of on hover. A dash when there are no fine rates, or no deposit item to measure from. */
function FineCell({ fine }: { fine: HeadFine | null }) {
  if (!fine) return <span className="text-ink-3">—</span>;
  if (fine.total <= 0) return <span className="text-ink-2">{money(0)}</span>;
  const why = `${fine.daysLate} day${fine.daysLate === 1 ? "" : "s"} late. Flat fine ${money(fine.flat)}, filing fee ${money(fine.volumeFee)}, interest ${money(fine.interest)}.`;
  return (
    <span title={why} className="cursor-help underline decoration-dotted underline-offset-2">
      {money(fine.total)}
    </span>
  );
}

const head = "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app";

/**
 * TDS withheld against TDS deposited: first by heading, then by deposit period. A deposit counts for the period it pays for, and a deposit
 * covers a heading for a period (not one withholding line), so the figures sit on these rows and not on each line of the report.
 */
export function TdsDepositTables({ position, title = "Withheld and deposited" }: { position: TdsDepositPosition; title?: string }) {
  const { rows, byHeading } = position;
  const total = byHeading.reduce((t, h) => ({ withheld: t.withheld + h.withheld, deposited: t.deposited + h.deposited, remaining: t.remaining + h.remaining, fine: t.fine + (h.fine?.total ?? 0) }), { withheld: 0, deposited: 0, remaining: 0, fine: 0 });
  const basis = position.fineBasis;
  if (rows.length === 0) return null;
  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-2">By deposit period, counting each deposit for the period it pays for. Voided payments are left out.</p>
      </div>
      {basis.missingRule && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">No TDS fine rates are published for your country, so fines are not shown. Ask your platform administrator to set them.</p>}
      {!basis.missingRule && basis.unverified && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">The TDS fine rates used here have not been confirmed against current law yet.</p>}

      <table className="w-full border-collapse text-[13px]">
        <thead className={`text-left text-xs text-ink-2 ${head}`}>
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Heading</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Withheld</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Deposited</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Still to deposit</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Fine and interest</th>
            <th className="px-2.5 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {byHeading.map((h) => (
            <tr key={h.headKey ?? "none"} className="border-b border-line">
              <td className="px-2.5 py-1.5">{h.heading}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{money(h.withheld)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{money(h.deposited)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{money(h.remaining)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">
                <FineCell fine={h.fine} />
              </td>
              <td className="px-2.5 py-1.5">
                <StatusPill tone={TONE[h.status]}>{DEPOSIT_STATUS_LABEL[h.status]}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <td className="px-2.5 py-1.5">Total</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{money(total.withheld)}</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{money(total.deposited)}</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{money(total.remaining)}</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{basis.missingRule ? "—" : money(total.fine)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div>
        <p className="mb-1 text-xs font-medium text-ink-2">By month</p>
        <table className="w-full border-collapse text-[13px]">
          <thead className={`text-left text-xs text-ink-2 ${head}`}>
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Period</th>
              <th className="px-2.5 py-1.5 font-medium">Heading</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Withheld</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Deposited</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Still to deposit</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Fine and interest</th>
              <th className="px-2.5 py-1.5 font-medium">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-2.5 py-1.5">{r.period}</td>
                <td className="px-2.5 py-1.5">{r.heading}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{money(r.withheld)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{money(r.deposited)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{money(r.remaining)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  <FineCell fine={r.fine} />
                </td>
                <td className="px-2.5 py-1.5">
                  <StatusPill tone={TONE[r.status]}>{DEPOSIT_STATUS_LABEL[r.status]}</StatusPill>
                </td>
                <td className="px-2.5 py-1.5 text-right print:hidden">
                  {r.remaining > 0.004 && (
                    <Link href="/compliance/tax" className="text-xs text-accent hover:underline">
                      {r.obligationId ? "Deposit" : "Open Tax compliance"}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-2">
        Fines run to {basis.asOf} and use the TDS fine rates in force on each deposit&apos;s due date. The filing fee and interest are charged on each amount for the days it was late, so each heading carries its own. The flat daily fine belongs to the return, so it is charged once and shared between the headings by how much of each was late. These are estimates: the tax office&apos;s assessment decides what is payable.
      </p>
    </div>
  );
}
