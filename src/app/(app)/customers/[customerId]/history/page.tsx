import { and, eq, asc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { customers, salesInvoices, receipts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";

type LedgerRow = { date: string; details: string; debit: number; credit: number };

export default async function CustomerHistoryPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const session = await requireTenantSession();

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!customer) notFound();

  const [invoices, customerReceipts] = await Promise.all([
    db
      .select({
        date: salesInvoices.invoiceDate,
        invoiceNumber: salesInvoices.invoiceNumber,
        total: salesInvoices.total,
        status: salesInvoices.status,
      })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.customerId, customerId), eq(salesInvoices.tenantId, session.tenantId)))
      .orderBy(asc(salesInvoices.invoiceDate)),
    db
      .select({ date: receipts.receiptDate, amount: receipts.amount })
      .from(receipts)
      .where(and(eq(receipts.receivedFromCustomerId, customerId), eq(receipts.tenantId, session.tenantId)))
      .orderBy(asc(receipts.receiptDate)),
  ]);

  const rows: LedgerRow[] = [];
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    rows.push({ date: inv.date, details: `Sales invoice ${inv.invoiceNumber}`, debit: Number(inv.total), credit: 0 });
  }
  for (const r of customerReceipts) {
    rows.push({ date: r.date, details: "Payment received", debit: 0, credit: Number(r.amount) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const openingBalance = Number(customer.openingBalance);
  let running = openingBalance;
  const ledgerRows = rows.map((r) => {
    running += r.debit - r.credit;
    return { ...r, balance: running };
  });

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Back to customers
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{customer.name}</h1>
        <p className="text-sm text-gray-500">Account history (Accounts Receivable)</p>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Details</th>
            <th className="px-4 py-2 font-medium">Debit</th>
            <th className="px-4 py-2 font-medium">Credit</th>
            <th className="px-4 py-2 font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-gray-100 bg-gray-50/50">
            <td className="px-4 py-2 text-gray-500">—</td>
            <td className="px-4 py-2 text-gray-500">Opening balance</td>
            <td className="px-4 py-2">{openingBalance > 0 ? fmt(openingBalance) : ""}</td>
            <td className="px-4 py-2">{openingBalance < 0 ? fmt(Math.abs(openingBalance)) : ""}</td>
            <td className="px-4 py-2 font-medium">{fmt(openingBalance)}</td>
          </tr>
          {ledgerRows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-4 py-2">{r.date}</td>
              <td className="px-4 py-2">{r.details}</td>
              <td className="px-4 py-2">{r.debit > 0 ? fmt(r.debit) : ""}</td>
              <td className="px-4 py-2">{r.credit > 0 ? fmt(r.credit) : ""}</td>
              <td className="px-4 py-2 font-medium">{fmt(r.balance)}</td>
            </tr>
          ))}
          {ledgerRows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                No transactions yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
