import { guardView } from "@/components/page-guard";
import { requireTenantSession } from "@/lib/session";
import { getTransferFormOptions } from "../actions";
import { TransferForm } from "../transfer-form";
import { PageHeader } from "@/components/ui/page-header";

export default async function NewTransferPage() {
  const denied = await guardView("payments");
  if (denied) return denied;
  await requireTenantSession();
  const options = await getTransferFormOptions();

  return (
    <div className="space-y-6">
      <PageHeader title="New Transfer" description="Move money from one cash or bank account to another." />
      <TransferForm options={options} />
    </div>
  );
}
