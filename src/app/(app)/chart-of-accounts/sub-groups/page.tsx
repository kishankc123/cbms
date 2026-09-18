import { and, eq, asc, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { SubGroupsTable } from "./sub-groups-table";

export default async function SubGroupsPage() {
  const session = await requireTenantSession();

  const [groups, subGroups] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, session.tenantId), isNull(accounts.parentAccountId)))
      .orderBy(asc(accounts.code)),
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, session.tenantId), isNotNull(accounts.parentAccountId)))
      .orderBy(asc(accounts.code)),
  ]);

  const groupById = Object.fromEntries(groups.map((g) => [g.id, g]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts — Sub-groups</h1>

      <SubGroupsTable groups={groups} subGroups={subGroups} groupById={groupById} />
    </div>
  );
}
