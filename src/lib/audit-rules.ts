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

export type AmountRule = typeof complianceRules.$inferSelect;

/** The active amount-threshold rules for a module, read once so a whole import can be checked against them without a query per row. */
export async function loadAmountRules(tenantId: string, module: RuleModule): Promise<AmountRule[]> {
  return db
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
}

/** Applies loaded rules to one amount: a blocking rule gives its message in `blocked`, a non-blocking one a warning. */
export function applyAmountRules(rules: AmountRule[], amount: number): { warnings: string[]; blocked: string | null } {
  const warnings: string[] = [];
  let blocked: string | null = null;
  const today = todayIso();
  for (const rule of rules) {
    if (rule.effectiveDate && rule.effectiveDate > today) continue;
    if (rule.expiryDate && rule.expiryDate < today) continue;
    if (!rule.thresholdValue || amount <= Number(rule.thresholdValue)) continue;

    if (rule.action === "block") blocked ??= `Blocked by rule "${rule.name}": amount exceeds ${Number(rule.thresholdValue).toFixed(2)}`;
    else warnings.push(`Rule "${rule.name}": amount exceeds ${Number(rule.thresholdValue).toFixed(2)}`);
  }
  return { warnings, blocked };
}

export async function evaluateAmountThresholdRules(tenantId: string, module: RuleModule, amount: number): Promise<string[]> {
  const { warnings, blocked } = applyAmountRules(await loadAmountRules(tenantId, module), amount);
  if (blocked) throw new Error(blocked);
  return warnings;
}
