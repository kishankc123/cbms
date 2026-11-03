import { requireTenantSession, can } from "@/lib/session";
import { ReadOnlyNotice } from "../ui";
import { getOpeningSheet } from "./actions";
import { OpeningBalancesForm } from "./opening-balances-form";
import { PageHeader } from "@/components/ui/page-header";

export default async function OpeningBalancesPage() {
  const session = await requireTenantSession();
  const canEdit = can(session, "chart_of_accounts", "edit");
  const sheet = await getOpeningSheet();

  return (
    <div className="space-y-5">
      <PageHeader title="Opening balances" className="!mb-0" />
      <ReadOnlyNotice canEdit={canEdit} />
      <OpeningBalancesForm sheet={sheet} canSave={canEdit} />
    </div>
  );
}
