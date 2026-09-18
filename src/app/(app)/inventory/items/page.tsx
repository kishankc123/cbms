import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { createItem } from "./actions";
import { DeleteItemButton } from "./delete-item-button";

export default async function ItemsPage() {
  const session = await requireTenantSession();

  const itemList = await db
    .select()
    .from(items)
    .where(eq(items.tenantId, session.tenantId))
    .orderBy(asc(items.name));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Items</h1>

      <form action={createItem} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input name="name" required className="w-48 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit</label>
          <input name="unit" placeholder="pcs, kg, ..." className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Default rate</label>
          <input
            name="defaultRate"
            type="number"
            step="0.01"
            min="0"
            className="w-32 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + Add item
        </button>
      </form>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Unit</th>
            <th className="px-4 py-2 font-medium">Default rate</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {itemList.map((it) => (
            <tr key={it.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{it.name}</td>
              <td className="px-4 py-2">{it.unit ?? "—"}</td>
              <td className="px-4 py-2">{Number(it.defaultRate).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-2 text-right">
                <DeleteItemButton itemId={it.id} name={it.name} />
              </td>
            </tr>
          ))}
          {itemList.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                No items yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
