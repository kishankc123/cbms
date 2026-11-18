import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";

type Round = { id: string; headingName: string; periodLabel: string; status: string; people: number; total: number };

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";

// The performance incentive rounds paid with this month: approved ones are in the figures below, a draft is not and is flagged.
export function IncentivesPanel({ rounds, locked }: { rounds: Round[]; locked: boolean }) {
  if (rounds.length === 0) return null;
  const waiting = rounds.filter((r) => r.status !== "approved").length;
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Performance incentives</h2>
          <p className="text-xs text-ink-2">
            Approved rounds are in this month&apos;s figures{locked ? "" : "; change an amount in its round, then recalculate"}.
          </p>
        </div>
        <Link href="/payroll/incentives" className="text-xs text-accent hover:underline">
          Open incentives
        </Link>
      </div>
      {waiting > 0 && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {waiting} incentive round{waiting === 1 ? " is" : "s are"} not approved yet, so {waiting === 1 ? "it is" : "they are"} not in this run.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Heading</th>
              <th className={th}>For</th>
              <th className={`${th} text-right`}>Employees</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.headingName}</td>
                <td className={td}>{r.periodLabel}</td>
                <td className={`${td} text-right tabular-nums`}>{r.people}</td>
                <td className={`${td} text-right tabular-nums`}>{r.total.toFixed(2)}</td>
                <td className={td}>{r.status === "approved" ? <StatusPill tone="success">In this run</StatusPill> : <StatusPill tone="pending">Not approved</StatusPill>}</td>
                <td className={`${td} text-right`}>
                  <Link href={`/payroll/incentives/${r.id}`} className="text-xs text-accent hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
