import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { items, purchaseBills, purchaseReturns, salesInvoices, salesReturns } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getStockCard } from "@/lib/inventory/stock";
import { D } from "@/components/calendar/date-text";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LABEL: Record<string, string> = {
  opening: "Opening stock",
  purchase: "Purchase",
  purchase_return: "Purchase return",
  sale: "Sale",
  sales_return: "Sales return",
  adjustment: "Adjustment",
};

export default async function StockCardPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const session = await requireTenantSession();
  const [item] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.tenantId, session.tenantId))).limit(1);
  if (!item) return <p className="text-sm text-red-600">Item not found.</p>;

  const card = await getStockCard(session.tenantId, itemId);
  // The document number behind each movement.
  const ids = (t: string) => [...new Set(card.filter((m) => m.sourceType === t && m.sourceId).map((m) => m.sourceId as string))];
  const [inv, bills, srs, prs] = await Promise.all([
    ids("sale").length ? db.select({ id: salesInvoices.id, n: salesInvoices.invoiceNumber }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, session.tenantId), inArray(salesInvoices.id, ids("sale")))) : [],
    ids("purchase").length ? db.select({ id: purchaseBills.id, n: purchaseBills.billNumber }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, session.tenantId), inArray(purchaseBills.id, ids("purchase")))) : [],
    ids("sales_return").length ? db.select({ id: salesReturns.id, n: salesReturns.noteNumber }).from(salesReturns).where(and(eq(salesReturns.tenantId, session.tenantId), inArray(salesReturns.id, ids("sales_return")))) : [],
    ids("purchase_return").length ? db.select({ id: purchaseReturns.id, n: purchaseReturns.noteNumber }).from(purchaseReturns).where(and(eq(purchaseReturns.tenantId, session.tenantId), inArray(purchaseReturns.id, ids("purchase_return")))) : [],
  ]);
  const number = new Map([...inv, ...bills, ...srs, ...prs].map((d) => [d.id, d.n]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory/stock" className="text-xs text-gray-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{item.name}</h1>
        <p className="text-sm text-gray-500">
          On hand {Number(item.stockQuantity)} · value {fmt(Number(item.stockValue))}
        </p>
      </div>

      <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Movement</th>
            <th className="px-4 py-2 font-medium">Reference</th>
            <th className="px-4 py-2 text-right font-medium">Quantity</th>
            <th className="px-4 py-2 text-right font-medium">Value</th>
            <th className="px-4 py-2 text-right font-medium">Balance qty</th>
            <th className="px-4 py-2 text-right font-medium">Balance value</th>
          </tr>
        </thead>
        <tbody>
          {card.map((m) => (
            <tr key={m.id} className="border-t border-gray-100">
              <td className="px-4 py-2"><D value={m.date} /></td>
              <td className="px-4 py-2">
                {LABEL[m.type] ?? m.type}
                {m.isReversal && <span className="ml-2 text-xs text-gray-500">(undone)</span>}
              </td>
              <td className="px-4 py-2 text-gray-500">{(m.sourceId && number.get(m.sourceId)) || m.note || "—"}</td>
              <td className="px-4 py-2 text-right">{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
              <td className="px-4 py-2 text-right">{m.value > 0 ? "+" : ""}{fmt(m.value)}</td>
              <td className="px-4 py-2 text-right">{m.balanceQuantity}</td>
              <td className="px-4 py-2 text-right">{fmt(m.balanceValue)}</td>
            </tr>
          ))}
          {card.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No stock movements yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
