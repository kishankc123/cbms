import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { AccountsTable } from "./accounts-table";

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

      <AccountsTable accounts={list} />
    </div>
  );
}
