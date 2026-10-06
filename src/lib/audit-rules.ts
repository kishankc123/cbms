import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceRules } from "@/db/schema";
import { todayIso } from "@/lib/calendar";

// Not a server action on purpose: it takes a tenantId, so it must only ever be called from other server code that already
// knows the signed-in organization, never directly from the browser.

// Evaluates any active "amount_threshold" rules for a module — the one
// live enforcement point wired into Expenses (see expenses/actions.ts).
// Returns a warning message (non-blocking) or throws (blocking), per each
// matching rule's configured action.
export type RuleModule = "sales" | "purchases" | "expenses" | "payroll" | "bank_reconciliation" | "general";

export async function evaluateAmountThresholdRules(tenantId: string, module: RuleModule, amount: number): Promise<string[]> {
  const rules = await db
    .select()
    .from(complianceRules)
    .where(
      and(
        eq(complianceRules.tenantId, tenantId),
        eq(complianceRules.applicableModule, module),
        eq(complianceRules.checkType, "amount_threshold"),
        eq(complianceRules.isActive, true)
      )
    );

  const warnings: string[] = [];
  const today = todayIso();
  for (const rule of rules) {
    if (rule.effectiveDate && rule.effectiveDate > today) continue;
    if (rule.expiryDate && rule.expiryDate < today) continue;
    if (!rule.thresholdValue || amount <= Number(rule.thresholdValue)) continue;

    if (rule.action === "block") {
      throw new Error(`Blocked by rule "${rule.name}": amount exceeds ${Number(rule.thresholdValue).toFixed(2)}`);
    }
    warnings.push(`Rule "${rule.name}": amount exceeds ${Number(rule.thresholdValue).toFixed(2)}`);
  }
  return warnings;
}
