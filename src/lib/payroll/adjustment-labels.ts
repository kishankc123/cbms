// The kinds of one-off adjustment on a salary sheet and what they are called. Pure (no database), so the screen can use it; the work is in run-adjustments.ts.

export type AdjustmentKind = "allowance" | "allowance_free" | "deduction";

export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = {
  allowance: "Allowance (taxable)",
  allowance_free: "Allowance (not taxable)",
  deduction: "Deduction",
};

export type RunAdjustment = { id: string; employeeId: string; employeeName: string; kind: AdjustmentKind; amount: number; reason: string };
