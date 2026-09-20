import { requireTenantSession } from "@/lib/session";
import { listAccountsWithBalances } from "@/lib/ledger/chart";
import { SubGroupsTable } from "./sub-groups-table";

export default async function SubGroupsPage() {
  const session = await requireTenantSession();
  const all = await listAccountsWithBalances(session.tenantId);
  const groups = all.filter((a) => a.parentAccountId === null);
  const subGroups = all.filter((a) => a.parentAccountId !== null);
  const parentById = Object.fromEntries(all.map((a) => [a.id, { id: a.id, code: a.code, name: a.name }]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts — Sub-groups</h1>

      <SubGroupsTable
        groups={groups.filter((g) => g.isActive).map((g) => ({ id: g.id, code: g.code, name: g.name }))}
        subGroups={subGroups.map((s) => ({ id: s.id, code: s.code, name: s.name, category: s.category, isActive: s.isActive, parentAccountId: s.parentAccountId, own: s.own, system: s.system }))}
        groupById={parentById}
      />
    </div>
  );
}
