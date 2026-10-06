import { guardView } from "@/components/page-guard";
import { listPeriods } from "../actions";
import { PeriodsTable } from "./periods-table";

export default async function PeriodsPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const periods = await listPeriods();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Period Locking</h1>
      <PeriodsTable periods={periods} />
    </div>
  );
}
