import { guardView } from "@/components/page-guard";
import { listExceptions, listAssignableUsers } from "../actions";
import { ExceptionsTable } from "./exceptions-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const denied = await guardView("audit");
  if (denied) return denied;
  const { fy } = await searchParams;
  const [data, assignableUsers] = await Promise.all([listExceptions(fy ?? null), listAssignableUsers()]);
  return (
    <div className="space-y-6">
      <PageHeader title="Exception Centre" className="!mb-0" />
      <ExceptionsTable exceptions={data.rows} years={data.years} selectedKey={data.selectedKey} assignableUsers={assignableUsers} />
    </div>
  );
}
