// What needs attention before the next payroll run, in plain words (no database).

export type AttentionInput = { activeEmployees: number; missingPan: number; missingBank: number; enrolledWithoutRegistration: number; slabsPublished: boolean; rulesPublished: boolean; rulesVerified: boolean; anyEnrolled: boolean };
export type AttentionItem = { key: string; text: string; tone: "warning" | "danger"; href: string };

/** The things worth a look before running payroll, in plain words. Empty when there is nothing to flag. */
export function attentionItems(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (!i.slabsPublished) out.push({ key: "slabs", tone: "danger", text: "No salary tax slabs are published for today, so no remuneration tax is being taken.", href: "/payroll/tax" });
  if (i.anyEnrolled && !i.rulesPublished) out.push({ key: "rules", tone: "danger", text: "Employees are enrolled in retirement schemes, but no payroll rules are published, so no contribution is being taken.", href: "/payroll/tax" });
  if (i.anyEnrolled && i.rulesPublished && !i.rulesVerified) out.push({ key: "unverified", tone: "warning", text: "The retirement contribution rates have not been confirmed against current law yet.", href: "/payroll/tax" });
  if (i.missingPan > 0) out.push({ key: "pan", tone: "warning", text: `${plural(i.missingPan, "active employee has", "active employees have")} no PAN recorded.`, href: "/payroll/employees" });
  if (i.missingBank > 0) out.push({ key: "bank", tone: "warning", text: `${plural(i.missingBank, "active employee has", "active employees have")} no bank account recorded.`, href: "/payroll/employees" });
  if (i.enrolledWithoutRegistration > 0) out.push({ key: "registration", tone: "warning", text: `${plural(i.enrolledWithoutRegistration, "retirement enrolment has", "retirement enrolments have")} no registration number. SSF is not worked out without one.`, href: "/payroll/employees" });
  return out;
}
