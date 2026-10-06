import { guardView } from "@/components/page-guard";
import { listExceptions, listAssignableUsers } from "../actions";
import { ExceptionsTable } from "./exceptions-table";

export default async function ExceptionsPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const [exceptions, assignableUsers] = await Promise.all([listExceptions(), listAssignableUsers()]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Exception Centre</h1>
      <ExceptionsTable exceptions={exceptions} assignableUsers={assignableUsers} />
    </div>
  );
}
