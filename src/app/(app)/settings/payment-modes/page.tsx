import { isOrgAdmin } from "@/lib/roles";
import { requireTenantSession } from "@/lib/session";
import { SettingsHeader } from "../ui";
import { getPaymentModes } from "./actions";
import { ModesScreen } from "./modes-screen";

export default async function PaymentModesPage() {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) return <p className="text-sm text-gray-500">Only an Owner or Administrator can manage payment modes.</p>;
  const data = await getPaymentModes();
  return (
    <div className="space-y-5">
      <SettingsHeader title="Payment modes" description="The ways money is received or paid. Link each mode to the accounts that hold that money; screens then ask for the mode first." />
      <ModesScreen data={data} />
    </div>
  );
}
