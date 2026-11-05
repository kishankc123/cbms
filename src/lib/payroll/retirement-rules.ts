// Retirement contributions and the tax rules around them (no database, safe for the browser). Which rates apply is law, so they come from a
// rule document a platform administrator publishes per country and date (see platform-rules.ts); nothing here hard-codes a rate.
// All money is worked in whole cents so figures never drift.

import { slabBreakdown, type Slab } from "@/lib/compliance/slab-tables";

export const SCHEME_KEYS = ["ssf", "pf"] as const;
export type SchemeKey = (typeof SCHEME_KEYS)[number];
/** What an employee can be enrolled in. CIT is an extra on top of SSF or PF, never instead of one of them. */
export type EmployeeScheme = SchemeKey | "cit";

/** One slice of a statutory scheme, for example the gratuity part of SSF. Rates are percentages of the contribution basis. */
export type SchemeLine = { key: string; label: string; employeePct: number; employerPct: number };
export type SchemeRule = {
  label: string;
  /** What the percentages are taken on. Only basic salary for now. */
  basis: "basic";
  lines: SchemeLine[];
  /** The most the percentages are taken on in a month (null = no cap). */
  monthlyBasisCap: number | null;
  /** Employment types that qualify (null = all). A mismatch is a warning, not a block. */
  eligibleEmploymentTypes: string[] | null;
  /** Whether joining this scheme can qualify an employee for the first-band (SST) exemption. The employee still has to be confirmed eligible. */
  sstExemptionPossible: boolean;
};

export type PayrollRules = {
  schemes: Record<SchemeKey, SchemeRule>;
  /** CIT has no fixed rate; these are the limits around what an employee chooses. */
  cit: { employerContributionAllowed: boolean; monthlyCeiling: number | null };
  /** The annual cap on retirement savings that reduce taxable income: the least of the actual amount, share of assessable income and a fixed sum. */
  retirementDeduction: { incomeShare: { num: number; den: number }; annualCap: number };
  /** How many of the lowest slabs are waived for an employee confirmed eligible for the exemption (the 1% social security band is the first). */
  sst: { exemptBands: number };
};

const toCents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const fromCents = (c: number) => c / 100;
/** Percentage of an amount, rounded to the nearest cent (halves up). */
const pctOfCents = (cents: number, pct: number) => Math.round((cents * pct) / 100 + 1e-9);

export type ContributionLine = { key: string; label: string; employee: number; employer: number };
export type Contribution = { basis: number; lines: ContributionLine[]; employee: number; employer: number; total: number };

/** What an employee and the employer pay into SSF or PF for one month, line by line. */
export function computeContribution(rule: SchemeRule, basicSalary: number): Contribution {
  const basis = Math.max(rule.monthlyBasisCap !== null ? Math.min(basicSalary, rule.monthlyBasisCap) : basicSalary, 0);
  const cents = toCents(basis);
  const lines = rule.lines.map((l) => ({ key: l.key, label: l.label, employee: fromCents(pctOfCents(cents, l.employeePct)), employer: fromCents(pctOfCents(cents, l.employerPct)) }));
  const employee = fromCents(lines.reduce((s, l) => s + toCents(l.employee), 0));
  const employer = fromCents(lines.reduce((s, l) => s + toCents(l.employer), 0));
  return { basis: fromCents(cents), lines, employee, employer, total: fromCents(toCents(employee) + toCents(employer)) };
}

export type CitChoice = { mode: "fixed" | "percent"; value: number; employerValue?: number };
/** A CIT contribution an employee chose: a fixed monthly sum or a percentage of basic salary, held to the monthly ceiling. */
export function computeCit(choice: CitChoice, basicSalary: number, rules: PayrollRules["cit"]): { employee: number; employer: number; cappedByCeiling: boolean } {
  const raw = choice.mode === "fixed" ? toCents(choice.value) : pctOfCents(toCents(basicSalary), choice.value);
  const ceiling = rules.monthlyCeiling === null ? Infinity : toCents(rules.monthlyCeiling);
  const employee = Math.max(Math.min(raw, ceiling), 0);
  const employer = rules.employerContributionAllowed && choice.employerValue ? Math.max(toCents(choice.employerValue), 0) : 0;
  return { employee: fromCents(employee), employer: fromCents(employer), cappedByCeiling: raw > ceiling };
}

export type RetirementDeduction = { allowed: number; limitedBy: "actual" | "income_share" | "annual_cap" | "none" };
/** What part of a year's retirement savings reduces taxable income: the least of the actual amount, a share of assessable income and the fixed cap. */
export function retirementDeduction(actualAnnual: number, assessableAnnual: number, limits: PayrollRules["retirementDeduction"]): RetirementDeduction {
  const actual = Math.max(toCents(actualAnnual), 0);
  if (actual === 0) return { allowed: 0, limitedBy: "none" };
  const share = Math.floor((Math.max(toCents(assessableAnnual), 0) * limits.incomeShare.num) / limits.incomeShare.den);
  const cap = toCents(limits.annualCap);
  const allowed = Math.min(actual, share, cap);
  return { allowed: fromCents(allowed), limitedBy: allowed === actual ? "actual" : allowed === share ? "income_share" : "annual_cap" };
}

/** The tax on the lowest `bands` slabs: what an employee confirmed for the first-band exemption is not charged. Never more than the tax itself. */
export function sstExemption(slabs: readonly Slab[], taxableIncome: number, bands: number): number {
  if (bands <= 0) return 0;
  const rows = slabBreakdown(slabs, taxableIncome).slice(0, bands);
  return fromCents(rows.reduce((s, r) => s + toCents(r.tax), 0));
}

/** True when the document has every part the calculator needs and each rate and limit makes sense. */
export function checkPayrollRules(input: unknown): { ok: true; rules: PayrollRules } | { ok: false; error: string } {
  const r = input as Partial<PayrollRules> | null;
  if (!r || typeof r !== "object") return { ok: false, error: "The rules are missing." };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const schemes = {} as Record<SchemeKey, SchemeRule>;
  for (const key of SCHEME_KEYS) {
    const s = r.schemes?.[key];
    const name = key.toUpperCase();
    if (!s || !Array.isArray(s.lines) || s.lines.length === 0) return { ok: false, error: `${name}: add at least one contribution line.` };
    const seen = new Set<string>();
    for (const l of s.lines) {
      if (!l.key || !l.label) return { ok: false, error: `${name}: every line needs a name.` };
      if (seen.has(l.key)) return { ok: false, error: `${name}: "${l.label}" is listed twice.` };
      seen.add(l.key);
      if (!num(l.employeePct) || !num(l.employerPct) || l.employeePct < 0 || l.employerPct < 0 || l.employeePct > 100 || l.employerPct > 100) return { ok: false, error: `${name}, ${l.label}: rates have to be between 0 and 100.` };
    }
    if (s.monthlyBasisCap !== null && !(num(s.monthlyBasisCap) && s.monthlyBasisCap > 0)) return { ok: false, error: `${name}: the monthly cap has to be more than zero, or left empty.` };
    schemes[key] = { label: s.label || name, basis: "basic", lines: s.lines, monthlyBasisCap: s.monthlyBasisCap ?? null, eligibleEmploymentTypes: s.eligibleEmploymentTypes ?? null, sstExemptionPossible: Boolean(s.sstExemptionPossible) };
  }
  const d = r.retirementDeduction;
  if (!d || !num(d.annualCap) || d.annualCap < 0 || !d.incomeShare || !num(d.incomeShare.num) || !num(d.incomeShare.den) || d.incomeShare.num <= 0 || d.incomeShare.den <= 0 || d.incomeShare.num > d.incomeShare.den) return { ok: false, error: "Retirement deduction: give a share of income (such as 1 in 3) and a yearly cap." };
  if (!r.sst || !Number.isInteger(r.sst.exemptBands) || r.sst.exemptBands < 0) return { ok: false, error: "Social security tax: enter how many of the lowest slabs are waived (0 for none)." };
  const cit = r.cit;
  if (!cit || (cit.monthlyCeiling !== null && !(num(cit.monthlyCeiling) && cit.monthlyCeiling > 0))) return { ok: false, error: "CIT: the monthly ceiling has to be more than zero, or left empty." };
  return { ok: true, rules: { schemes, cit: { employerContributionAllowed: Boolean(cit.employerContributionAllowed), monthlyCeiling: cit.monthlyCeiling }, retirementDeduction: d, sst: { exemptBands: r.sst.exemptBands } } };
}

/** The values the specification starts Nepal from. They are unverified and have to be confirmed against current law before live payroll relies on them. */
export const NEPAL_DEFAULT_RULES: PayrollRules = {
  schemes: {
    ssf: {
      label: "Social Security Fund",
      basis: "basic",
      lines: [
        { key: "provident_fund", label: "Provident fund", employeePct: 10, employerPct: 10 },
        { key: "gratuity", label: "Gratuity", employeePct: 0, employerPct: 8.33 },
        { key: "other", label: "Other SSF components", employeePct: 1, employerPct: 1.67 },
      ],
      monthlyBasisCap: null,
      eligibleEmploymentTypes: null,
      sstExemptionPossible: true,
    },
    pf: {
      label: "Provident fund",
      basis: "basic",
      lines: [{ key: "provident_fund", label: "Provident fund", employeePct: 10, employerPct: 10 }],
      monthlyBasisCap: null,
      eligibleEmploymentTypes: null,
      sstExemptionPossible: false,
    },
  },
  cit: { employerContributionAllowed: true, monthlyCeiling: null },
  retirementDeduction: { incomeShare: { num: 1, den: 3 }, annualCap: 500000 },
  sst: { exemptBands: 1 },
};

export function sameRules(a: PayrollRules, b: PayrollRules): boolean {
  // The database keeps json keys in its own order, so compare with the keys sorted.
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, sorted(x)])) : v);
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
