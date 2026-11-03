import { guardView } from "@/components/page-guard";
import { listAuditTrail } from "../actions";
import { AuditTrailTable } from "./audit-trail-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function AuditTrailPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const entries = await listAuditTrail({});
  return (
    <div className="space-y-6">
      <PageHeader title="Audit Trail" description="Who changed what, and when." className="!mb-0" />
      <AuditTrailTable initialEntries={entries} />
    </div>
  );
}
