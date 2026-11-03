import { guardView } from "@/components/page-guard";
import { listPeriods } from "../actions";
import { PeriodsTable } from "./periods-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function PeriodsPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const periods = await listPeriods();
  return (
    <div className="space-y-6">
      <PageHeader title="Period Locking" className="!mb-0" />
      <PeriodsTable periods={periods} />
    </div>
  );
}
