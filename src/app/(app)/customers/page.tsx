import { guardView } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCustomerLines } from "@/lib/ledger/customer-balances";
import { partyBuckets } from "@/lib/ledger/party-statement";
import { isCashSaleCustomer } from "@/lib/sales/cash-sale";
import { CustomersTable } from "./customers-table";

export default async function CustomersPage() {
  const denied = await guardView("sales");
  if (denied) return denied;
  const session = await requireTenantSession();

  const [customerList, lines] = await Promise.all([
    db.select().from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    getCustomerLines(session.tenantId),
  ]);

  // Balances come from each customer's own ledger account, so a manual journal voucher posted to it is included.
  // Only real customers who buy on credit: the "Cash Sale" stand-in for walk-in buyers is left out (its sales are fully paid on the spot).
  const rows = customerList.filter((c) => !isCashSaleCustomer(c.name)).map((c) => {
    const b = partyBuckets(lines.get(c.id) ?? [], "debit");
    return {
      id: c.id,
      name: c.name,
      phone: c.contactInfo?.phone ?? "",
      details: c.contactInfo?.details ?? "",
      openingBalance: Number(c.openingBalance),
      ledgerOpening: b.opening,
      invoices: b.invoices,
      receipts: b.payments,
      others: b.others,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>

      <CustomersTable customers={rows} />
    </div>
  );
}
