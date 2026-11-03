import { guardView } from "@/components/page-guard";
import { listAuditTrail } from "../actions";
import { AuditTrailTable } from "./audit-trail-table";

export default async function AuditTrailPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const entries = await listAuditTrail({});
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Audit Trail</h1>
      <AuditTrailTable initialEntries={entries} />
    </div>
  );
}
