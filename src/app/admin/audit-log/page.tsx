export default function AdminAuditLogPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold text-gray-900">Platform Audit Log</h1>
      <p className="text-sm text-gray-500">
        Not built yet. This will list every platform-level action (audit_log rows with tenantId = null) — who suspended an organization, who published a tax rate, who granted platform admin to whom — the same accountability the rest of the system already keeps for tenant-level actions.
      </p>
    </div>
  );
}
