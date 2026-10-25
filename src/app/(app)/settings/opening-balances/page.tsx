import { requireTenantSession, can } from "@/lib/session";
import { ReadOnlyNotice } from "../ui";
import { getOpeningSheet } from "./actions";
import { OpeningBalancesForm } from "./opening-balances-form";

export default async function OpeningBalancesPage() {
  const session = await requireTenantSession();
  const canEdit = can(session, "chart_of_accounts", "edit");
  const sheet = await getOpeningSheet();

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Opening balances</h1>
      <ReadOnlyNotice canEdit={canEdit} />
      <OpeningBalancesForm sheet={sheet} canSave={canEdit} />
    </div>
  );
}
