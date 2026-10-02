import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getCustomerLines } from "@/lib/ledger/customer-balances";
import { buildStatement } from "@/lib/ledger/party-ledger";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { CustomerStatementView } from "./customer-statement-view";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function CustomerStatementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [fiscal, activeFiscalYear] = await Promise.all([getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const list = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.tenantId, session.tenantId))
    .orderBy(asc(customers.name));

  const customerId = typeof sp.customer === "string" && list.some((c) => c.id === sp.customer) ? sp.customer : null;

  let statement = null;
  if (customerId) {
    const linesByCustomer = await getCustomerLines(session.tenantId);
    const lines = linesByCustomer.get(customerId) ?? [];
    const built = buildStatement(lines, "debit", { from, to });
    const name = list.find((c) => c.id === customerId)?.name ?? "";
    statement = { customerName: name, openingBalance: built.openingBalance, closingBalance: built.closingBalance, rows: built.rows };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Customer Statement</h1>
      </div>
      <CustomerStatementView customers={list} customerId={customerId} from={from} to={to} fiscal={fiscal} statement={statement} />
    </div>
  );
}
