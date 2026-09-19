import { requireTenantSession } from "@/lib/session";
import { getTransferFormOptions } from "../actions";
import { TransferForm } from "../transfer-form";

export default async function NewTransferPage() {
  await requireTenantSession();
  const options = await getTransferFormOptions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">New Transfer</h1>
        <p className="mt-0.5 text-sm text-gray-500">Move money from one cash or bank account to another.</p>
      </div>
      <TransferForm options={options} />
    </div>
  );
}
