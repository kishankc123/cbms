import { guardView } from "@/components/page-guard";
import { requireTenantSession } from "@/lib/session";
import { getPaymentFormOptions, listPayments, getPaymentSummary } from "../actions";
import { PaymentsWorkspace } from "../payments-workspace";

import { presetRange, todayIso } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";

export default async function MoneyInPage() {
  const denied = await guardView("payments");
  if (denied) return denied;
  const session = await requireTenantSession();

  // The current month in the organization's calendar (BS month for BS orgs).
  const fiscal = await getFiscalRange(session.tenantId);
  const { from, to } = presetRange("this_month", session.calendar, todayIso(), fiscal);

  const [formOptions, initialPayments, summary] = await Promise.all([
    getPaymentFormOptions(),
    listPayments({ from, to, direction: "money_in" }),
    getPaymentSummary({ from, to, direction: "money_in" }),
  ]);

  return (
    <div>
      <PaymentsWorkspace
        title="Money in"
        description="Record and manage money received by the business."
        formOptions={formOptions}
        initialPayments={initialPayments}
        initialSummary={summary}
        initialFrom={from}
        initialTo={to}
        fiscal={fiscal}
        fixedDirection="money_in"
      />
    </div>
  );
}
