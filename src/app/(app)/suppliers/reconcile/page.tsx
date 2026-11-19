import { guardView } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { listReconciliations } from "@/lib/suppliers/reconcile";
import { todayIso } from "@/lib/calendar";
import { ReconcileStart } from "./reconcile-start";

// Reconcile statements: upload a supplier's own statement and check it against what your books say you owe them.
export default async function ReconcilePage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const denied = await guardView("purchases");
  if (denied) return denied;
  const { supplier } = await searchParams;
  const session = await requireTenantSession();
  const [suppliers, past] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    listReconciliations(session.tenantId),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Reconcile statements" description="Check a supplier's statement against what your books say you owe them." className="!mb-0" />
      <ReconcileStart
        suppliers={suppliers}
        initialSupplierId={suppliers.some((s) => s.id === supplier) ? supplier! : ""}
        today={todayIso()}
        canCreate={can(session, "purchases", "create")}
        past={past.map((r) => ({ id: r.id, vendorName: r.vendorName, from: r.fromDate, to: r.toDate, fileName: r.fileName, status: r.status, lines: r.lines, matched: r.matched }))}
      />
    </div>
  );
}
