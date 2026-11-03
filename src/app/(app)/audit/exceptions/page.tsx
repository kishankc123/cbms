import { guardView } from "@/components/page-guard";
import { listExceptions, listAssignableUsers } from "../actions";
import { ExceptionsTable } from "./exceptions-table";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const denied = await guardView("audit");
  if (denied) return denied;
  const { fy } = await searchParams;
  const [data, assignableUsers] = await Promise.all([listExceptions(fy ?? null), listAssignableUsers()]);
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Exception Centre</h1>
      <ExceptionsTable exceptions={data.rows} years={data.years} selectedKey={data.selectedKey} assignableUsers={assignableUsers} />
    </div>
  );
}
