import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { requireTenantSession, requireUserSession } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { getActiveFiscalYear } from "@/lib/fiscal";
import { StatStrip } from "@/components/ui/stat-strip";
import { DataTable, Td, Th, Tr } from "@/components/ui/data-table";
import { D } from "@/components/calendar/date-text";
import { loadCashCycle } from "@/lib/dashboard/cash-cycle";
import { DashboardHeader } from "../dashboard-header";
import { money } from "../cash-sections";

const days = (n: number | null) => (n === null ? "Not measurable" : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`);

export default async function CashCycleTab() {
  const denied = await guardView("chart_of_accounts");
  if (denied) return denied;
  const session = await requireTenantSession();
  const user = await requireUserSession();

  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const d = await loadCashCycle(session.tenantId, todayIso());
  const { cycle: c, inputs: i } = d;

  const rows = [
    { key: "dso", name: "Days to collect", days: c.dso.days, perDay: c.dso.perDay, how: `${money(i.receivables)} owed by customers against ${money(i.sales)} invoiced`, better: "a day sooner", why: "Customers' unpaid invoices, measured against how much you sell." },
    { key: "dio", name: "Days of stock held", days: c.dio.days, perDay: c.dio.perDay, how: `${money(i.stock)} of stock at cost against ${money(i.costOfSales)} cost of what was sold`, better: "a day less", why: "How long stock sits before it is sold." },
    { key: "dpo", name: "Days to pay suppliers", days: c.dpo.days, perDay: c.dpo.perDay, how: `${money(i.payables)} owed on credit bills against ${money(i.purchases)} bought on credit`, better: "a day later", why: "How long you take to pay what you buy on credit." },
  ];

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} />

      <StatStrip
        items={[
          { label: "Days to collect", value: days(c.dso.days) },
          { label: "Days of stock", value: days(c.dio.days) },
          { label: "Days to pay suppliers", value: days(c.dpo.days) },
          { label: "Cash cycle", value: days(c.cycleDays), tone: c.cycleDays !== null && c.cycleDays > 60 ? "warning" : "default" },
        ]}
      />
      <p className="-mt-3 text-xs text-ink-2">
        The cash cycle is how long money is tied up: days to collect plus days of stock, less days you take to pay suppliers. The shorter it is, the less cash the business needs to run. Measured over the last 90 days (<D value={d.from} style="short" /> to <D value={d.to} style="short" />).
      </p>

      <StatStrip
        className="!border-y-0"
        items={[
          { label: "Tied up in the cycle", value: money(c.tiedUp) },
          { label: "Owed by customers", value: money(i.receivables) },
          { label: "Stock at cost", value: money(i.stock) },
          { label: "Owed to suppliers", value: money(i.payables) },
        ]}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">What each part is worth</h2>
        <DataTable>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>Part</Th>
              <Th align="right">Days</Th>
              <Th>Worked out from</Th>
              <Th align="right">Cash freed if it improved by a day</Th>
            </Tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td>
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="block text-xs text-ink-2">{r.why}</span>
                </Td>
                <Td numeric>{days(r.days)}</Td>
                <Td className="text-xs text-ink-2">{r.how}</Td>
                <Td numeric>
                  {money(r.perDay)}
                  <span className="block text-xs text-ink-2">{r.better}</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Customers who pay slowest</h2>
          {d.slowPayers.length === 0 ? (
            <p className="border-y border-line py-4 text-[13px] text-ink-2">No customer with at least 3 settled invoices in the last 6 months pays late on average.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] border-y border-line">
              {d.slowPayers.map((s) => (
                <li key={s.customerId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/reports/customer-statement?customer=${s.customerId}`} className="truncate text-[13px] text-ink hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs text-ink-2">Across {s.invoices} settled invoices</p>
                  </div>
                  <span className="tnum shrink-0 text-[13px] font-medium text-ink">{s.daysLate} days late on average</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-ink-2">
            {d.actualDaysToPay !== null ? `Invoices that were settled in the last 6 months took ${d.actualDaysToPay} days from invoice to payment on average, leaving out same-day cash sales.` : "Nothing has been settled on credit in the last 6 months yet."}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Read this with care</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-ink-2">
            <li>Days to collect uses everything invoiced, so cash sales paid on the spot make it look shorter than what credit customers really take. The settled-invoice figure under Customers who pay slowest leaves them out.</li>
            <li>Days to pay counts credit bills only. Cash purchases and asset purchases are left out, and so are unpaid expenses such as rent.</li>
            <li>Days of stock uses the cost of goods sold from the ledger. With no stock, it is zero days.</li>
            <li>If something is owed but nothing was invoiced or bought in the window, that part cannot be measured and the cycle is not shown.</li>
            <li>This is a snapshot of today against the last 90 days. A history of how it has moved needs figures kept month by month, which is not stored yet.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
