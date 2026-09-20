import { requireTenantSession } from "@/lib/session";
import { listAccountsWithBalances } from "@/lib/ledger/chart";
import { AccountsTable } from "./accounts-table";

export default async function ChartOfAccountsPage() {
  const session = await requireTenantSession();
  const list = (await listAccountsWithBalances(session.tenantId)).filter((a) => a.parentAccountId === null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts — Groups</h1>

      <AccountsTable accounts={list.map((a) => ({ id: a.id, code: a.code, name: a.name, category: a.category, subCategory: a.subCategory, isActive: a.isActive, total: a.total, system: a.system }))} />
    </div>
  );
}
