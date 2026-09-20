import { requireTenantSession } from "@/lib/session";
import { getPaymentFormOptions, listPayments, getPaymentSummary } from "../actions";
import { PaymentsWorkspace } from "../payments-workspace";

import { presetRange, todayIso } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";

export default async function MoneyOutPage() {
  const session = await requireTenantSession();

  // The current month in the organization's calendar (BS month for BS orgs).
  const fiscal = await getFiscalRange(session.tenantId);
  const { from, to } = presetRange("this_month", session.calendar, todayIso(), fiscal);

  const [formOptions, initialPayments, summary] = await Promise.all([
    getPaymentFormOptions(),
    listPayments({ from, to, direction: "money_out" }),
    getPaymentSummary({ from, to, direction: "money_out" }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Money Out</h1>
          <p className="mt-0.5 text-sm text-gray-500">Record and manage money paid by the business.</p>
        </div>
      </div>

      <PaymentsWorkspace
        formOptions={formOptions}
        initialPayments={initialPayments}
        initialSummary={summary}
        initialFrom={from}
        initialTo={to}
        fiscal={fiscal}
        fixedDirection="money_out"
      />
    </div>
  );
}
