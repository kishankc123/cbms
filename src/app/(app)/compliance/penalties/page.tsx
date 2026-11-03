import { guardView } from "@/components/page-guard";
import { getPenaltyCalculatorContext } from "./actions";
import { PenaltyCalculator } from "./penalty-calculator";
import { PenaltyRates } from "./penalty-rates";
import { PageHeader } from "@/components/ui/page-header";

export default async function PenaltiesPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const ctx = await getPenaltyCalculatorContext();
  return (
    <div className="space-y-6">
      <PageHeader title="Fines & Penalties" description="Work out the late-filing penalty, late-payment penalty and interest for a period, and record it against the tax type." />
      <PenaltyRates />
      {ctx.taxTypes.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No tax types are configured for your country yet.</div>
      ) : (
        <PenaltyCalculator calendar={ctx.calendar} taxTypes={ctx.taxTypes} canRecord={ctx.canRecord} />
      )}
    </div>
  );
}
