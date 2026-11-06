// What an employee's salary components come to in a pay period (no database). A component is a catalog entry (allowance or deduction, fixed
// sum or percentage of the basic salary paid, taxable or not, counted for retirement or not, every month or once); an assignment gives it to one
// employee for a stretch of time, with their own amount if it differs from the catalog's.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type CatalogComponent = {
  id: string;
  name: string;
  type: "allowance" | "deduction";
  amount: number;
  taxable: boolean;
  calcType: "fixed" | "percent";
  countsForRetirement: boolean;
  recurrence: "recurring" | "one_time";
};
export type Assignment = { componentId: string; amount: number | null; effectiveFrom: string; effectiveTo: string | null };

export type ComponentLine = { componentId: string; name: string; type: "allowance" | "deduction"; calcType: "fixed" | "percent"; /** The figure paid (money), whatever the calculation type. */ amount: number; taxable: boolean; countsForRetirement: boolean };
export type ComponentPay = {
  lines: ComponentLine[];
  allowances: number;
  deductions: number;
  /** Allowances that count toward tax. */
  taxableAllowances: number;
  /** Allowances that count toward the retirement (SSF / PF) basis. */
  retirementAllowances: number;
};

/** True when the assignment covers the period; a one-time component only counts in the period that holds its date. */
export function appliesInPeriod(c: CatalogComponent, a: Assignment, periodStart: string, periodEnd: string): boolean {
  if (c.recurrence === "one_time") return a.effectiveFrom >= periodStart && a.effectiveFrom <= periodEnd;
  return a.effectiveFrom <= periodEnd && (!a.effectiveTo || a.effectiveTo >= periodStart);
}

export function componentPay(catalog: CatalogComponent[], assignments: Assignment[], period: { periodStart: string; periodEnd: string; proratedBasic: number }): ComponentPay {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const lines: ComponentLine[] = [];
  for (const a of assignments) {
    const c = byId.get(a.componentId);
    if (!c || !appliesInPeriod(c, a, period.periodStart, period.periodEnd)) continue;
    const figure = a.amount ?? c.amount;
    const amount = c.calcType === "percent" ? round2((period.proratedBasic * figure) / 100) : round2(figure);
    lines.push({ componentId: c.id, name: c.name, type: c.type, calcType: c.calcType, amount, taxable: c.taxable, countsForRetirement: c.countsForRetirement });
  }
  const sum = (f: (l: ComponentLine) => boolean) => round2(lines.filter(f).reduce((s, l) => s + l.amount, 0));
  return { lines, allowances: sum((l) => l.type === "allowance"), deductions: sum((l) => l.type === "deduction"), taxableAllowances: sum((l) => l.type === "allowance" && l.taxable), retirementAllowances: sum((l) => l.type === "allowance" && l.countsForRetirement) };
}

/** Components that should be given to a newly added employee. */
export const autoAssigned = (catalog: { id: string; autoAssign: boolean }[]) => catalog.filter((c) => c.autoAssign).map((c) => c.id);

/** A suggested starting set (earnings only). Nothing is added unless the organization asks for it. */
export const STARTER_COMPONENTS: { name: string; recurrence: "recurring" | "one_time" }[] = [
  { name: "House Rent Allowance", recurrence: "recurring" },
  { name: "Dearness Allowance", recurrence: "recurring" },
  { name: "Travel Allowance", recurrence: "recurring" },
  { name: "Communication Allowance", recurrence: "recurring" },
  { name: "Food Allowance", recurrence: "recurring" },
  { name: "Festival Allowance", recurrence: "one_time" },
  { name: "Bonus", recurrence: "one_time" },
  { name: "Overtime", recurrence: "one_time" },
  { name: "Other Allowances", recurrence: "recurring" },
];
