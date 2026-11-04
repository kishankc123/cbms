import { guardView } from "@/components/page-guard";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { listCheques } from "@/lib/cheques/cheques";
import { ChequesWorkspace } from "./cheques-workspace";

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export default async function IssuedChequesPage() {
  const denied = await guardView("payments");
  if (denied) return denied;
  const session = await requireTenantSession();
  const today = todayIso();
  // Every cheque still waiting to clear, and the ones that finished in the last 90 days.
  const cheques = await listCheques(session.tenantId, addDays(today, -90));

  return <ChequesWorkspace cheques={cheques} today={today} canCreate={can(session, "payments", "create")} canEdit={can(session, "payments", "edit")} canVoid={can(session, "payments", "void")} />;
}
