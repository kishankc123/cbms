import { guardView } from "@/components/page-guard";
import { can, requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { getReconciliation, ReconError } from "@/lib/suppliers/reconcile";
import { bridge } from "@/lib/suppliers/reconcile-rules";
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
      />
    </div>
  );
}
