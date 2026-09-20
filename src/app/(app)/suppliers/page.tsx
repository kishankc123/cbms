import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getSupplierLines } from "@/lib/ledger/supplier-balances";
import { partyBuckets } from "@/lib/ledger/party-statement";
import { SuppliersTable } from "./suppliers-table";

export default async function SuppliersPage() {
  const session = await requireTenantSession();

  const [supplierList, lines] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    getSupplierLines(session.tenantId),
  ]);

  // Balances come from each supplier's own ledger account, so a manual journal voucher posted to it is included.
  const rows = supplierList.map((s) => {
    const b = partyBuckets(lines.get(s.id) ?? [], "credit");
    return {
      id: s.id,
      name: s.name,
      phone: (s.contactInfo as { phone?: string; details?: string } | null)?.phone ?? "",
      details: (s.contactInfo as { phone?: string; details?: string } | null)?.details ?? "",
      openingBalance: Number(s.openingBalance),
      ledgerOpening: b.opening,
      bills: b.invoices,
      payments: b.payments,
      others: b.others,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Suppliers</h1>

      <SuppliersTable suppliers={rows} />
    </div>
  );
}
