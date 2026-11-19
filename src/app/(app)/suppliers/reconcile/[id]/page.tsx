import { guardView } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getExpenseTaxDefaults } from "../../../expenses/actions";
import { getPaymentFormOptions } from "../../../payments/actions";
import { can, requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { getReconciliation, ReconError } from "@/lib/suppliers/reconcile";
import { bridge } from "@/lib/suppliers/reconcile-rules";
import { loadReportHeader } from "@/lib/report-header";
import { ReconcileDetail } from "./reconcile-detail";

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await guardView("purchases");
  if (denied) return denied;
  const { id } = await params;
  const session = await requireTenantSession();

  let d: Awaited<ReturnType<typeof getReconciliation>>;
  try {
    d = await getReconciliation(session.tenantId, id);
  } catch (e) {
    if (e instanceof ReconError) return <p className="text-sm text-red-600">{e.message}</p>;
    throw e;
  }

  // What the bill and payment forms need, only for someone who may use them on a reconciliation still open.
  const open = d.recon.status !== "reconciled" && can(session, "purchases", "edit");
  const expenseForm =
    open && can(session, "expenses", "create")
      ? await Promise.all([
          db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
          getExpenseCategoryAccounts(session.tenantId),
          getCashBankAccounts(session.tenantId),
          getExpenseTaxDefaults(),
        ]).then(([vendorList, categoryAccounts, cashBankAccounts, tax]) => ({ vendors: vendorList, categoryAccounts, cashBankAccounts, vatRate: tax.vatRate }))
      : null;
  const paymentForm = open && can(session, "payments", "create") ? await getPaymentFormOptions() : null;

  const header = await loadReportHeader(session.tenantId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={d.vendor.name}
        description={d.recon.fileName}
        back={{ href: "/suppliers/reconcile", label: "Reconcile statements" }}
        className="!mb-0"
      />
      <ReconcileDetail
        reconId={d.recon.id}
        vendorId={d.vendor.id}
        vendorName={d.vendor.name}
        from={d.recon.fromDate}
        to={d.recon.toDate}
        status={d.recon.status}
        notes={d.recon.notes ?? ""}
        ourClosing={d.ours.closing}
        theirClosing={Number(d.recon.theirClosing)}
        proof={d.proof}
        bridge={bridge(d.ours.closing, d.proof)}
        theirs={d.theirs}
        ours={d.ours.lines}
        groups={d.groups}
        theirsOnly={d.theirsOnly.map((l) => ({ id: l.id, date: l.date, reference: l.reference, description: l.description, effect: l.effect, reason: l.flag?.reason ?? "", note: l.flag?.note ?? "" }))}
        oursOnly={d.oursOnly.map((l) => ({ id: l.id, date: l.date, reference: l.reference, description: l.description, effect: l.effect, reason: l.flag?.reason ?? "", note: l.flag?.note ?? "" }))}
        unresolved={d.unresolved}
        suggested={d.suggested}
        stale={d.stale}
        canEdit={can(session, "purchases", "edit")}
        canDelete={can(session, "purchases", "delete")}
        canReopen={isOrgAdmin(session.role)}
        header={header}
        signedOffAt={d.recon.signedOffAt ? d.recon.signedOffAt.toISOString().slice(0, 10) : ""}
        expenseForm={expenseForm}
        paymentForm={paymentForm}
      />
    </div>
  );
}
