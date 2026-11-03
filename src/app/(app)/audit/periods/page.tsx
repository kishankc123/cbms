import { guardView } from "@/components/page-guard";
import { listPeriods } from "../actions";
import { PeriodsTable } from "./periods-table";

export default async function PeriodsPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const periods = await listPeriods();
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Period Locking</h1>
      <PeriodsTable periods={periods} />
    </div>
  );
}
