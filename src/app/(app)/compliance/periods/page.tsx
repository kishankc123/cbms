import { listPeriods } from "../actions";
import { PeriodsTable } from "./periods-table";

export default async function PeriodsPage() {
  const periods = await listPeriods();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Period Locking</h1>
      <PeriodsTable periods={periods} />
    </div>
  );
}
