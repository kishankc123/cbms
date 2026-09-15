import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { createAccount } from "./actions";

const CATEGORIES = ["asset", "liability", "equity", "income", "expense"] as const;

export default async function ChartOfAccountsPage() {
  const session = await requireTenantSession();
  const list = await db
    .select()
    .from(accounts)
    .where(eq(accounts.tenantId, session.tenantId))
    .orderBy(asc(accounts.code));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts</h1>

      <form action={createAccount} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Code</label>
          <input name="code" required className="rounded border border-gray-300 px-2 py-1.5 text-sm w-24" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input name="name" required className="rounded border border-gray-300 px-2 py-1.5 text-sm w-56" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select name="category" required className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
          Add account
        </button>
      </form>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-mono">{a.code}</td>
              <td className="px-4 py-2">{a.name}</td>
              <td className="px-4 py-2 capitalize">{a.category}</td>
              <td className="px-4 py-2">{a.isActive ? "Active" : "Inactive"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
