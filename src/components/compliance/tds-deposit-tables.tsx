import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { DEPOSIT_STATUS_LABEL, type DepositStatus, type TdsDepositPosition } from "@/lib/compliance/tds-deposit-rules";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE: Record<DepositStatus, StatusTone> = { deposited: "success", part: "pending", none: "action", no_item: "critical" };

const head = "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app";

/**
 * TDS withheld against TDS deposited: first by heading, then by deposit period. A deposit counts for the period it pays for, and a deposit
 * covers a heading for a period (not one withholding line), so the figures sit on these rows and not on each line of the report.
 */
export function TdsDepositTables({ position, title = "Withheld and deposited" }: { position: TdsDepositPosition; title?: string }) {
  const { rows, byHeading } = position;
  const total = byHeading.reduce((t, h) => ({ withheld: t.withheld + h.withheld, deposited: t.deposited + h.deposited, remaining: t.remaining + h.remaining }), { withheld: 0, deposited: 0, remaining: 0 });
  if (rows.length === 0) return null;
  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-2">By deposit period, counting each deposit for the period it pays for. Voided payments are left out.</p>
      </div>

      <table className="w-full border-collapse text-[13px]">
        <thead className={`text-left text-xs text-ink-2 ${head}`}>
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Heading</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Withheld</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Deposited</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Still to deposit</th>
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
    </div>
  );
}
