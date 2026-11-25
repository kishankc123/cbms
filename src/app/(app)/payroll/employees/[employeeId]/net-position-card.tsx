import { StatusPill } from "@/components/ui/status-pill";
import type { NetPosition } from "@/lib/payroll/net-position";

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The employee's salary account and advance account set against each other, for the top of their page. A view only: nothing is posted. */
export function NetPositionCard({ position }: { position: NetPosition }) {
  const { salaryOwed, advanceHeld, amount, side } = position;
  if (salaryOwed === 0 && advanceHeld === 0) return null;
  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-ink-2">Salary owed to the employee</p>
          <p className="text-base font-semibold tabular-nums text-ink">{money.format(salaryOwed)}</p>
        </div>
        <span aria-hidden className="text-lg text-ink-3">−</span>
        <div>
          <p className="text-xs text-ink-2">Advances not yet recovered</p>
          <p className="text-base font-semibold tabular-nums text-ink">{money.format(advanceHeld)}</p>
        </div>
        <span aria-hidden className="text-lg text-ink-3">=</span>
        <div>
          <p className="text-xs text-ink-2">Net position</p>
          <p className="flex items-center gap-2 text-base font-semibold tabular-nums text-ink">
            {money.format(amount)}
            <StatusPill tone={side === "even" ? "success" : side === "company_owes" ? "pending" : "action"}>
              {side === "company_owes" ? "Company owes employee" : side === "employee_owes" ? "Employee owes company" : "Settled"}
            </StatusPill>
          </p>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-ink-3">The two accounts stay separate in your books. This sets them against each other so you can see what is left to pay or to recover.</p>
    </section>
  );
}
