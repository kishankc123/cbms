import { listAuditTrail } from "../actions";
import { AuditTrailTable } from "./audit-trail-table";

export default async function AuditTrailPage() {
  const entries = await listAuditTrail({});
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Audit Trail</h1>
      <AuditTrailTable initialEntries={entries} />
    </div>
  );
}
