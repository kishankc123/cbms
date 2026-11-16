import type { DateRange } from "@/lib/calendar";
import { cashFlowStatement } from "./reports";
import { buildCashFlowComparison, EMPTY_PERIOD } from "./cashflow-compare-rules";

const at = (iso: string) => new Date(iso + "T00:00:00Z");

/** The cash flow statement for a period; with a second period it sets the two side by side. */
export async function comparativeCashFlow(tenantId: string, current: DateRange, previous?: DateRange) {
  const [cur, prev] = await Promise.all([cashFlowStatement(tenantId, at(current.from), at(current.to)), previous ? cashFlowStatement(tenantId, at(previous.from), at(previous.to)) : EMPTY_PERIOD]);
  return buildCashFlowComparison(cur, prev);
}
