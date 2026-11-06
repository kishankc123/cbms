import { guardView, guardSalary } from "@/components/page-guard";
import { PageHeader } from "@/components/ui/page-header";
import { getContributions } from "./actions";
import { ContributionsWorkspace } from "./contributions-workspace";

// What payroll owes SSF, PF and CIT (built up each time a payroll run is finalized) and the payments made to clear it.
export default async function ContributionsPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const data = await getContributions();
  return (
    <div className="space-y-6">
      <PageHeader title="Contributions" className="!mb-0" />
      <ContributionsWorkspace data={data} />
    </div>
  );
}
