import { and, eq, asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { AccountsTable } from "./accounts-table";

export default async function ChartOfAccountsPage() {
  const session = await requireTenantSession();
  const list = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), isNull(accounts.parentAccountId)))
    .orderBy(asc(accounts.code));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts — Groups</h1>

      <AccountsTable accounts={list} />
    </div>
  );
}
