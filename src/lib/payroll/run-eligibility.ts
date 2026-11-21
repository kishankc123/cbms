// Who a payroll run pays on its own: everyone employed at some point in the period, i.e. joined on or before its last day and had not left before its first.
// Staff whose status is not Active (inactive, on leave) are not picked up unless they left during the period. A person can also be left out of one run on purpose.

export type EmploymentFacts = { employmentStatus: string; joiningDate: string; leavingDate: string | null };

/** Why this person is not part of a run for the period, or null when they are. Dates are ISO (YYYY-MM-DD). */
export function whyNotInRun(e: EmploymentFacts, periodStart: string, periodEnd: string): string | null {
  if (e.joiningDate > periodEnd) return `Joins on ${e.joiningDate}, after this period ends`;
  if (e.leavingDate && e.leavingDate < periodStart) return `Left on ${e.leavingDate}, before this period starts`;
  if (e.employmentStatus !== "active" && !(e.leavingDate && e.leavingDate >= periodStart)) return `Status is ${e.employmentStatus.replace("_", " ")}, not Active. Set them to Active on their profile`;
  return null;
}
