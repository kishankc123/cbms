import { getPenaltyCalculatorContext } from "./actions";
import { PenaltyCalculator } from "./penalty-calculator";

export default async function PenaltiesPage() {
  const ctx = await getPenaltyCalculatorContext();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Fines & Penalties</h1>
        <p className="mt-0.5 text-sm text-gray-500">Work out the late-filing penalty, late-payment penalty and interest for a period, and record it against the tax type.</p>
      </div>
      {ctx.taxTypes.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No tax types are configured for your country yet.</div>
      ) : (
        <PenaltyCalculator calendar={ctx.calendar} taxTypes={ctx.taxTypes} canRecord={ctx.canRecord} />
      )}
    </div>
  );
}
