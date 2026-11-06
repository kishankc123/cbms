// What one employee's retirement contributions come to in a pay period, and which ledger account each part posts to (no database).
// The platform's rules supply the rates; the employee's enrolments say which scheme applies. Anyone with no enrolment gets nothing here, so
// their pay, tax and journal lines are exactly as they were before retirement schemes existed.

import { type Enrolment, SCHEME_NAMES } from "./employee-retirement";
import { computeCit, computeContribution, type EmployeeScheme, type PayrollRules } from "./retirement-rules";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type RetirementLine = { scheme: EmployeeScheme; key: string; label: string; employee: number; employer: number };
export type RetirementPay = {
  lines: RetirementLine[];
  /** Taken from the employee's pay. */
  employee: number;
  /** An extra cost to the employer; never reduces net pay. */
  employer: number;
  /** In SSF this period, so the first-band exemption can apply if the employee is confirmed for it. */
  inSsf: boolean;
  warnings: string[];
};

/** True when an enrolment covers any day of the period (a scheme that ended mid-month still contributes for that month). */
export const enrolledDuring = (e: Pick<Enrolment, "startDate" | "endDate">, periodStart: string, periodEnd: string) => e.startDate <= periodEnd && (!e.endDate || e.endDate >= periodStart);

const PERMISSIVE_CIT: PayrollRules["cit"] = { employerContributionAllowed: true, monthlyCeiling: null };

export function retirementPay(input: { enrolments: Enrolment[]; rules: PayrollRules | null; proratedBasic: number; retirementAllowances: number; periodStart: string; periodEnd: string }): RetirementPay {
  const out: RetirementPay = { lines: [], employee: 0, employer: 0, inSsf: false, warnings: [] };
  const basis = round2(input.proratedBasic + input.retirementAllowances);
  for (const e of input.enrolments) {
    if (!enrolledDuring(e, input.periodStart, input.periodEnd)) continue;
    if (e.scheme === "cit") {
      if (!e.citMode || !e.citValue) {
        out.warnings.push("CIT is recorded without the amount the employee chose, so nothing was taken for it.");
        continue;
      }
      const cit = computeCit({ mode: e.citMode, value: e.citValue, employerValue: e.citEmployerValue ?? undefined }, input.proratedBasic, input.rules?.cit ?? PERMISSIVE_CIT);
      if (cit.employee > 0 || cit.employer > 0) out.lines.push({ scheme: "cit", key: "cit", label: SCHEME_NAMES.cit, employee: cit.employee, employer: cit.employer });
      if (cit.cappedByCeiling) out.warnings.push("The CIT contribution was held to the monthly ceiling.");
      continue;
    }
    if (!input.rules) {
      out.warnings.push(`No payroll rules are published for this country, so nothing was taken for ${SCHEME_NAMES[e.scheme]}.`);
      continue;
    }
    if (e.scheme === "ssf" && !(e.registrationNumber ?? "").trim()) {
      out.warnings.push("SSF has no registration number, so nothing was taken for it.");
      continue;
    }
    const c = computeContribution(input.rules.schemes[e.scheme], basis);
    for (const l of c.lines) if (l.employee > 0 || l.employer > 0) out.lines.push({ scheme: e.scheme, key: l.key, label: l.label, employee: l.employee, employer: l.employer });
    if (e.scheme === "ssf") out.inSsf = true;
  }
  out.employee = round2(out.lines.reduce((s, l) => s + l.employee, 0));
  out.employer = round2(out.lines.reduce((s, l) => s + l.employer, 0));
  return out;
}

/** The liability accounts contributions are owed to. Each is created the first time it is needed (see retirement-accounts.ts). */
export const RETIREMENT_ACCOUNTS = {
  employee_ssf: "Employee SSF Payable",
  employer_ssf: "Employer SSF Payable",
  gratuity: "Gratuity Payable",
  employee_pf: "Employee PF Payable",
  employer_pf: "Employer PF Payable",
  cit: "CIT Payable",
} as const;
export type RetirementAccountKey = keyof typeof RETIREMENT_ACCOUNTS;

/** Where one contribution line posts. The employer's gratuity has an account of its own; CIT (employee and employer) is one account. */
export function accountsOf(l: RetirementLine): { account: RetirementAccountKey; amount: number }[] {
  const parts: { account: RetirementAccountKey; amount: number }[] = [];
  if (l.scheme === "cit") {
    const amount = round2(l.employee + l.employer);
    return amount > 0 ? [{ account: "cit", amount }] : [];
  }
  const employeeAccount: RetirementAccountKey = l.scheme === "ssf" ? "employee_ssf" : "employee_pf";
  const employerAccount: RetirementAccountKey = l.scheme === "ssf" ? (l.key === "gratuity" ? "gratuity" : "employer_ssf") : "employer_pf";
  if (l.employee > 0) parts.push({ account: employeeAccount, amount: l.employee });
  if (l.employer > 0) parts.push({ account: employerAccount, amount: l.employer });
  return parts;
}

/** The credits for a whole run, by account, from every employee's contribution lines. */
export function creditsFor(lines: RetirementLine[]): Partial<Record<RetirementAccountKey, number>> {
  const totals: Partial<Record<RetirementAccountKey, number>> = {};
  for (const l of lines) for (const p of accountsOf(l)) totals[p.account] = round2((totals[p.account] ?? 0) + p.amount);
  return totals;
}
