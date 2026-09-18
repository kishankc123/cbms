import { eq, asc, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills, payments, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { SuppliersTable } from "./suppliers-table";

export default async function SuppliersPage() {
  const session = await requireTenantSession();

  const [tenant, supplierList, bills, supplierPayments] = await Promise.all([
    db
      .select({ fiscalYearStartDate: tenants.fiscalYearStartDate })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(vendors)
      .where(eq(vendors.tenantId, session.tenantId))
      .orderBy(asc(vendors.name)),
    db
      .select({ vendorId: purchaseBills.vendorId, date: purchaseBills.billDate, total: purchaseBills.total })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, session.tenantId), ne(purchaseBills.status, "void"))),
    db
      .select({ vendorId: payments.paidToVendorId, date: payments.paymentDate, amount: payments.amount })
      .from(payments)
      .where(eq(payments.tenantId, session.tenantId)),
  ]);

  const billsByVendor = new Map<string, { date: string; total: number }[]>();
  for (const b of bills) {
    const list = billsByVendor.get(b.vendorId) ?? [];
    list.push({ date: b.date, total: Number(b.total) });
    billsByVendor.set(b.vendorId, list);
  }

  const paymentsByVendor = new Map<string, { date: string; amount: number }[]>();
  for (const p of supplierPayments) {
    if (!p.vendorId) continue;
    const list = paymentsByVendor.get(p.vendorId) ?? [];
    list.push({ date: p.date, amount: Number(p.amount) });
    paymentsByVendor.set(p.vendorId, list);
  }

  const rows = supplierList.map((s) => ({
    id: s.id,
    name: s.name,
    phone: (s.contactInfo as { phone?: string; details?: string } | null)?.phone ?? "",
    details: (s.contactInfo as { phone?: string; details?: string } | null)?.details ?? "",
    openingBalance: Number(s.openingBalance),
    bills: billsByVendor.get(s.id) ?? [],
    payments: paymentsByVendor.get(s.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Suppliers</h1>

      <SuppliersTable suppliers={rows} fiscalYearStartDate={tenant?.fiscalYearStartDate ?? null} />
    </div>
  );
}
