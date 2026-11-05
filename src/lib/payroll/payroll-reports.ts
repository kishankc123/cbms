// The payroll reports, worked out from finalized payroll lines (no database, safe for the browser). Every figure comes from what each run
// froze when it was finalized, so a report never changes because a rate or a salary changed afterwards.

import type { TdsWorking } from "./salary-tax-calc";
import type { RetirementLine } from "./retirement-pay";
import { DEPOSIT_STATUS_LABEL, type DepositMonthRow } from "@/lib/compliance/tds-deposit-rules";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ReportLine = {
  runId: string;
  periodStart: string;
  periodEnd: string;
  period: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  panNumber: string | null;
  basic: number;
  gross: number;
  taxablePay: number;
  tds: number;
  advance: number;
  otherDeductions: number;
  employeeRetirement: number;
  employerRetirement: number;
  retirement: RetirementLine[];
  tdsDetail: TdsWorking | null;
  net: number;
};

export type Column = { key: string; label: string; numeric?: boolean };
export type ReportTable = { columns: Column[]; rows: Record<string, string | number>[]; totals: Record<string, string | number> | null; note?: string };

const sumOf = (rows: Record<string, string | number>[], key: string) => round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
const withTotals = (columns: Column[], rows: Record<string, string | number>[], label: string, note?: string): ReportTable => ({
  columns,
  rows,
  totals: rows.length === 0 ? null : { [columns[0].key]: label, ...Object.fromEntries(columns.filter((c) => c.numeric).map((c) => [c.key, sumOf(rows, c.key)])) },
  note,
});
const byPeriodThenName = (a: ReportLine, b: ReportLine) => a.periodEnd.localeCompare(b.periodEnd) || a.fullName.localeCompare(b.fullName);

export type Scheme = "ssf" | "pf" | "cit";
export const SCHEME_REPORT_NAMES: Record<Scheme, string> = { ssf: "SSF contribution report", pf: "PF contribution report", cit: "CIT contribution report" };

/** Employee and employer contributions to one scheme, by employee and month. `registrations` maps "employeeId:scheme" to the registration number. */
export function contributionReport(scheme: Scheme, lines: ReportLine[], registrations: Map<string, string>): ReportTable {
  const columns: Column[] = [
    { key: "period", label: "Period" },
    { key: "employee", label: "Employee" },
    { key: "registration", label: "Registration no." },
    { key: "employeeShare", label: "Employee", numeric: true },
    { key: "employerShare", label: "Employer", numeric: true },
    ...(scheme === "ssf" ? [{ key: "gratuity", label: "of which gratuity", numeric: true }] : []),
    { key: "total", label: "Total", numeric: true },
  ];
  const rows = [...lines]
    .sort(byPeriodThenName)
    .map((l) => {
      const mine = l.retirement.filter((r) => r.scheme === scheme);
      const employeeShare = round2(mine.reduce((s, r) => s + r.employee, 0));
      const employerShare = round2(mine.reduce((s, r) => s + r.employer, 0));
      return { l, employeeShare, employerShare, gratuity: round2(mine.filter((r) => r.key === "gratuity").reduce((s, r) => s + r.employer, 0)) };
    })
    .filter((x) => x.employeeShare > 0 || x.employerShare > 0)
    .map(({ l, employeeShare, employerShare, gratuity }) => ({ period: l.period, employee: `${l.employeeCode} ${l.fullName}`, registration: registrations.get(`${l.employeeId}:${scheme}`) ?? "", employeeShare, employerShare, gratuity, total: round2(employeeShare + employerShare) }));
  return withTotals(columns, rows, "Total");
}

/** Remuneration tax withheld each month, by employee. */
export function monthlyTdsReport(lines: ReportLine[]): ReportTable {
  const columns: Column[] = [
    { key: "period", label: "Period" },
    { key: "employee", label: "Employee" },
    { key: "pan", label: "PAN" },
    { key: "taxablePay", label: "Taxable pay", numeric: true },
    { key: "tds", label: "Tax withheld", numeric: true },
  ];
  const rows = [...lines].sort(byPeriodThenName).map((l) => ({ period: l.period, employee: `${l.employeeCode} ${l.fullName}`, pan: l.panNumber ?? "", taxablePay: l.taxablePay, tds: l.tds }));
  return withTotals(columns, rows, "Total");
}

const groupByEmployee = (lines: ReportLine[]) => {
  const m = new Map<string, ReportLine[]>();
  for (const l of lines) m.set(l.employeeId, [...(m.get(l.employeeId) ?? []), l]);
  for (const list of m.values()) list.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return [...m.values()].sort((a, b) => a[0].fullName.localeCompare(b[0].fullName));
};

/** Salary tax withheld against deposited, by deposit period (the same figures as the compliance TDS report, for the salary heading only). */
export function tdsDepositReport(rows: DepositMonthRow[]): ReportTable {
  const columns: Column[] = [
    { key: "period", label: "Deposit period" },
    { key: "withheld", label: "Withheld", numeric: true },
    { key: "deposited", label: "Deposited", numeric: true },
    { key: "remaining", label: "Still to deposit", numeric: true },
    { key: "fine", label: "Fine and interest (estimate)", numeric: true },
    { key: "status", label: "Status" },
  ];
  const body = rows.map((r) => ({ period: r.period, withheld: r.withheld, deposited: r.deposited, remaining: r.remaining, fine: r.fine?.total ?? 0, status: DEPOSIT_STATUS_LABEL[r.status] }));
  return withTotals(columns, body, "Total", "Fines are estimates to today from the TDS fine rates in force on each due date. The tax office's assessment decides what is payable.");
}

/** Each employee's year: pay, tax withheld and what they put into retirement schemes. */
export function annualTaxSummary(lines: ReportLine[]): ReportTable {
  const columns: Column[] = [
    { key: "employee", label: "Employee" },
    { key: "pan", label: "PAN" },
    { key: "months", label: "Months paid", numeric: true },
    { key: "gross", label: "Gross pay", numeric: true },
    { key: "taxablePay", label: "Taxable pay", numeric: true },
    { key: "retirement", label: "Retirement savings", numeric: true },
    { key: "tds", label: "Tax withheld", numeric: true },
    { key: "net", label: "Net pay", numeric: true },
  ];
  const rows = groupByEmployee(lines).map((list) => ({
    employee: `${list[0].employeeCode} ${list[0].fullName}`,
    pan: list[0].panNumber ?? "",
    months: list.length,
    gross: round2(list.reduce((s, l) => s + l.gross, 0)),
    taxablePay: round2(list.reduce((s, l) => s + l.taxablePay, 0)),
    retirement: round2(list.reduce((s, l) => s + l.employeeRetirement, 0)),
    tds: round2(list.reduce((s, l) => s + l.tds, 0)),
    net: round2(list.reduce((s, l) => s + l.net, 0)),
  }));
  return withTotals(columns, rows, "Total");
}

/**
 * The year's tax as the last run in the range worked it out (projected income, retirement deduction, first-band exemption, tax for the year)
 * against what was withheld. A positive difference is still to be withheld; a negative one is withheld in excess.
 */
export function annualReconciliation(lines: ReportLine[]): ReportTable {
  const columns: Column[] = [
    { key: "employee", label: "Employee" },
    { key: "projected", label: "Income for the year", numeric: true },
    { key: "retirement", label: "Retirement deduction", numeric: true },
    { key: "exemption", label: "First-band exemption", numeric: true },
    { key: "annualTax", label: "Tax for the year", numeric: true },
    { key: "withheld", label: "Withheld (incl. earlier employer)", numeric: true },
    { key: "difference", label: "Still to withhold / (excess)", numeric: true },
  ];
  const rows = groupByEmployee(lines).map((list) => {
    const last = list[list.length - 1];
    const w = last.tdsDetail;
    const withheldThisEmployer = round2(list.reduce((s, l) => s + l.tds, 0));
    // What was withheld before the first run in the range counts too (earlier runs in the same fiscal year, and the earlier employer).
    const withheld = w ? round2(w.withheldBefore + w.priorTds + last.tds) : withheldThisEmployer;
    const annualTax = w?.annualTax ?? 0;
    return { employee: `${list[0].employeeCode} ${list[0].fullName}`, projected: w?.projected ?? 0, retirement: w?.retirementDeduction ?? 0, exemption: w?.sstExemption ?? 0, annualTax, withheld, difference: round2(annualTax - withheld) };
  });
  return withTotals(columns, rows, "Total", "Worked out on the last payroll run in the range. Choose a whole fiscal year for a true year-end reconciliation.");
}

/** What payroll costs the employer each month: gross pay plus the employer's contributions. */
export function employerExpenseReport(lines: ReportLine[]): ReportTable {
  const columns: Column[] = [
    { key: "period", label: "Period" },
    { key: "employees", label: "Employees", numeric: true },
    { key: "gross", label: "Gross salary", numeric: true },
    { key: "employer", label: "Employer contributions", numeric: true },
    { key: "cost", label: "Employer payroll cost", numeric: true },
  ];
  const byPeriod = new Map<string, ReportLine[]>();
  for (const l of lines) byPeriod.set(l.runId, [...(byPeriod.get(l.runId) ?? []), l]);
  const rows = [...byPeriod.values()]
    .sort((a, b) => a[0].periodEnd.localeCompare(b[0].periodEnd))
    .map((list) => {
      const gross = round2(list.reduce((s, l) => s + l.gross, 0));
      const employer = round2(list.reduce((s, l) => s + l.employerRetirement, 0));
      return { period: list[0].period, employees: list.length, gross, employer, cost: round2(gross + employer) };
    });
  return withTotals(columns, rows, "Total");
}

/** Net pay earned in the range, what has been paid out in it, and what each employee is still owed now. */
export function netSalaryPaymentReport(lines: ReportLine[], paid: Map<string, number>, owedNow: Map<string, number>): ReportTable {
  const columns: Column[] = [
    { key: "employee", label: "Employee" },
    { key: "net", label: "Net salary", numeric: true },
    { key: "paid", label: "Paid in the range", numeric: true },
    { key: "owed", label: "Still owed now", numeric: true },
  ];
  const rows = groupByEmployee(lines).map((list) => ({ employee: `${list[0].employeeCode} ${list[0].fullName}`, net: round2(list.reduce((s, l) => s + l.net, 0)), paid: round2(paid.get(list[0].employeeId) ?? 0), owed: round2(owedNow.get(list[0].employeeId) ?? 0) }));
  return withTotals(columns, rows, "Total", "Still owed is the balance on each employee's salary payable account today, whatever the range.");
}

/** What payroll owes today, by account (not limited to a range). */
export function liabilityReport(items: { label: string; amount: number }[]): ReportTable {
  const columns: Column[] = [{ key: "label", label: "Owed to" }, { key: "amount", label: "Amount owed", numeric: true }];
  const rows = items.map((i) => ({ label: i.label, amount: round2(i.amount) }));
  return withTotals(columns, rows, "Total", "As of today. Salary payable is what employees are owed; the rest is held for the tax office and the funds until it is paid.");
}

export const REPORTS = [
  { key: "salary", label: "Monthly salary sheet", href: "/payroll/salary-sheet", external: true },
  { key: "payroll-summary", label: "Payroll summary", href: "/reports/payroll-summary", external: true },
  { key: "ssf", label: "SSF contributions" },
  { key: "pf", label: "PF contributions" },
  { key: "cit", label: "CIT contributions" },
  { key: "tds", label: "Monthly remuneration tax" },
  { key: "annual", label: "Annual employee tax summary" },
  { key: "reconciliation", label: "Annual tax reconciliation" },
  { key: "employer", label: "Employer payroll expense" },
  { key: "liability", label: "Payroll liabilities" },
  { key: "netpay", label: "Net salary payments" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];
