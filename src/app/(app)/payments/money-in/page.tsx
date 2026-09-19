import { requireTenantSession } from "@/lib/session";
import { getPaymentFormOptions, listPayments, getPaymentSummary } from "../actions";
import { PaymentsWorkspace } from "../payments-workspace";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

export default async function MoneyInPage() {
  await requireTenantSession();

  const from = monthStart();
  const to = today();

  const [formOptions, initialPayments, summary] = await Promise.all([
    getPaymentFormOptions(),
    listPayments({ from, to, direction: "money_in" }),
    getPaymentSummary({ from, to, direction: "money_in" }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Money In</h1>
          <p className="mt-0.5 text-sm text-gray-500">Record and manage money received by the business.</p>
        </div>
      </div>

      <PaymentsWorkspace
        formOptions={formOptions}
        initialPayments={initialPayments}
        initialSummary={summary}
        initialFrom={from}
        initialTo={to}
        fixedDirection="money_in"
      />
    </div>
  );
}
