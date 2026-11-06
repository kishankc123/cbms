// Which retirement scheme an employee is in on a date, and whether a new enrolment is allowed (no database, safe for the browser).
// Nobody is enrolled unless someone enrolls them: an employee with no row here has no contribution and no change to net pay or tax.

import type { EmployeeScheme, PayrollRules } from "./retirement-rules";

export const SCHEME_NAMES: Record<EmployeeScheme, string> = { ssf: "Social Security Fund (SSF)", pf: "Provident fund (PF)", cit: "Citizen Investment Trust (CIT)" };

export type Enrolment = { id?: string; scheme: EmployeeScheme; registrationNumber: string | null; startDate: string; endDate: string | null; citMode: "fixed" | "percent" | null; citValue: number | null; citEmployerValue: number | null };

const overlaps = (a: Pick<Enrolment, "startDate" | "endDate">, b: Pick<Enrolment, "startDate" | "endDate">) => a.startDate <= (b.endDate ?? "9999-12-31") && b.startDate <= (a.endDate ?? "9999-12-31");

/** The enrolments in force on a date (a payroll run reads these for the pay period). */
export function enrolmentsOn(rows: Enrolment[], date: string): Enrolment[] {
  return rows.filter((r) => r.startDate <= date && (!r.endDate || r.endDate >= date));
}

/** Plain-language reason a new enrolment is not allowed, or null. `existing` is everything already recorded for the employee. */
export function checkEnrolment(input: Enrolment, existing: Enrolment[], employee: { joiningDate: string; leavingDate: string | null }): string | null {
  if (!input.startDate) return "Enter the date the contributions start from.";
  if (input.endDate && input.endDate < input.startDate) return "The end date can't be before the start date.";
  if (input.startDate < employee.joiningDate) return `The start date can't be before the employee joined on ${employee.joiningDate}.`;
  if (input.scheme === "ssf" && !(input.registrationNumber ?? "").trim()) return "Enter the SSF registration number. SSF contributions are not worked out without it.";
  for (const e of existing) {
    if (e.id && e.id === input.id) continue;
    if (!overlaps(input, e)) continue;
    if (e.scheme === input.scheme) return `${SCHEME_NAMES[input.scheme]} is already recorded for part of this period (from ${e.startDate}${e.endDate ? ` to ${e.endDate}` : ""}). End it first, or start after it.`;
    if (input.scheme !== "cit" && e.scheme !== "cit") return `An employee can't be in SSF and PF at the same time. ${SCHEME_NAMES[e.scheme]} runs from ${e.startDate}${e.endDate ? ` to ${e.endDate}` : ""}.`;
  }
  if (input.scheme === "cit") {
    if (input.citMode !== "fixed" && input.citMode !== "percent") return "Choose whether the CIT contribution is a fixed amount or a percentage of basic salary.";
    if (input.citValue === null || !Number.isFinite(input.citValue) || input.citValue <= 0) return "Enter the CIT contribution the employee has chosen.";
    if (input.citMode === "percent" && input.citValue > 100) return "A percentage can't be more than 100.";
    if (input.citEmployerValue !== null && (!Number.isFinite(input.citEmployerValue) || input.citEmployerValue < 0)) return "The employer's CIT contribution can't be negative.";
  }
  return null;
}

/** Things worth a look but not a block: shown on the profile and, later, on the payroll run. */
export function enrolmentWarnings(rows: Enrolment[], employee: { employmentType: string; leavingDate: string | null; panNumber: string | null; sstEligible: boolean }, rules: PayrollRules | null, today: string): string[] {
  const out: string[] = [];
  const now = enrolmentsOn(rows, today);
  for (const e of now) {
    if (e.scheme === "ssf" && !(e.registrationNumber ?? "").trim()) out.push("SSF has no registration number.");
    if (e.scheme === "pf" && !(e.registrationNumber ?? "").trim()) out.push("PF has no registration number.");
    if (e.scheme === "cit" && !(e.registrationNumber ?? "").trim()) out.push("CIT has no registration number.");
    if (e.scheme !== "cit" && rules) {
      const allowed = rules.schemes[e.scheme].eligibleEmploymentTypes;
      if (allowed && !allowed.includes(employee.employmentType)) out.push(`${SCHEME_NAMES[e.scheme]} usually covers ${allowed.map((t) => t.replace("_", " ")).join(", ")} staff only. This employee is ${employee.employmentType.replace("_", " ")}.`);
    }
    if (e.scheme === "cit" && rules && !rules.cit.employerContributionAllowed && (e.citEmployerValue ?? 0) > 0) out.push("An employer CIT contribution is recorded, but the rules do not allow one.");
  }
  if (employee.sstEligible && !now.some((e) => e.scheme === "ssf" && rules?.schemes.ssf.sstExemptionPossible)) out.push("Marked eligible for the first-band exemption, but the employee is not in a scheme that allows it.");
  if (now.length > 0 && !(employee.panNumber ?? "").trim()) out.push("No PAN is recorded, which tax returns and contribution filings usually need.");
  if (employee.leavingDate && now.some((e) => !e.endDate)) out.push("The employee has a leaving date but a scheme with no end date.");
  return out;
}
