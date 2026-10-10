import { assertValidCondition, type Condition } from "./engine/applicability";
import { assertValidDueRule, type DueRule, type PeriodKind } from "./engine/due-rules";

// Plain-language views of a requirement template's two structured rules (when it is due, and who it applies to), and the form the
// platform administrator edits the due date in. Pure: nothing here touches the database.

/** The facts an applicability condition can test (see engine/facts.ts) — what the editor offers help for. */
export const KNOWN_FACTS: { fact: string; help: string }[] = [
  { fact: "country_code", help: "the organization's country code, e.g. NP" },
  { fact: "entity_type", help: "the company type, e.g. private_limited" },
  { fact: "registered_tax_types", help: "the taxes it is registered for (a list): vat, tds, excise, pan" },
  { fact: "vat_filing_frequency", help: "monthly or quarterly" },
  { fact: "has_employees", help: "true when it has an active employee" },
  { fact: "withholds_tax", help: "true when it withholds tax (TDS) at source" },
];

export const PERIOD_OPTIONS: { value: PeriodKind; label: string; help: string }[] = [
  { value: "month", label: "Each month", help: "the calendar month in the country's statutory calendar" },
  { value: "quarter", label: "Each quarter (3 months)", help: "from the first month of the fiscal year" },
  { value: "term", label: "Each term (4 months)", help: "three per fiscal year, as in Nepal's quarterly VAT" },
  { value: "fiscal_year", label: "Each fiscal year", help: "one return per fiscal year" },
  { value: "event", label: "After an event", help: "raised when something happens, not on a schedule" },
];

const ORDINAL = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
};

/** "The 25th of the following month" — a due rule in words. */
export function describeDueRule(rule: unknown): string {
  if (!rule) return "No due date (raised only when something happens)";
  try {
    assertValidDueRule(rule);
  } catch (e) {
    return `Not understood: ${e instanceof Error ? e.message : "invalid rule"}`;
  }
  const r: DueRule = rule;
  const period = { month: "the month", quarter: "the quarter", term: "the term", fiscal_year: "the fiscal year", event: "the event" }[r.period];
  if (r.daysAfterEnd !== undefined) return `${r.daysAfterEnd} day${r.daysAfterEnd === 1 ? "" : "s"} after the end of ${period}`;
  const months = r.monthsAfterEnd ?? 0;
  const day = r.dayOfMonth === undefined ? "The same day" : r.dayOfMonth === "last" ? "The last day" : `The ${ORDINAL(r.dayOfMonth)}`;
  const where = months === 0 ? `of the month ${period} ends in` : months === 1 ? "of the following month" : `of the ${ORDINAL(months)} month after`;
  return `${day} ${where}${months === 0 || months === 1 ? "" : ` ${period} ends`}`;
}

const OP_TEXT: Record<string, string> = { eq: "is", neq: "is not", in: "is one of", includes: "includes", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most" };
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

/** "Registered for VAT and the filing basis is not quarterly" — an applicability condition in words. */
export function describeCondition(c: unknown): string {
  if (c === null || c === undefined) return "Every organization";
  try {
    assertValidCondition(c);
  } catch (e) {
    return `Not understood: ${e instanceof Error ? e.message : "invalid condition"}`;
  }
  const walk = (x: Condition, top: boolean): string => {
    if ("all" in x) return wrap(x.all.map((y) => walk(y, false)).join(" and "), top || x.all.length === 1);
    if ("any" in x) return wrap(x.any.map((y) => walk(y, false)).join(" or "), top || x.any.length === 1);
    if ("not" in x) return `not (${walk(x.not, true)})`;
    return `${x.fact.replace(/_/g, " ")} ${OP_TEXT[x.op] ?? x.op} ${show(x.value)}`;
  };
  const wrap = (s: string, bare: boolean) => (bare ? s : `(${s})`);
  return walk(c, true);
}

export type DueRuleForm = {
  period: PeriodKind;
  /** "day" = a day of a later month; "days" = a number of days after the period ends. */
  mode: "day" | "days";
  monthsAfterEnd: string;
  /** 1-31, or "last". */
  dayOfMonth: string;
  daysAfterEnd: string;
};

export const blankDueRuleForm = (): DueRuleForm => ({ period: "month", mode: "day", monthsAfterEnd: "1", dayOfMonth: "25", daysAfterEnd: "" });

export function dueRuleToForm(rule: unknown): DueRuleForm {
  if (!rule || typeof rule !== "object") return blankDueRuleForm();
  const r = rule as DueRule;
  if (r.daysAfterEnd !== undefined) return { period: r.period, mode: "days", monthsAfterEnd: "0", dayOfMonth: "", daysAfterEnd: String(r.daysAfterEnd) };
  return { period: r.period, mode: "day", monthsAfterEnd: String(r.monthsAfterEnd ?? 0), dayOfMonth: r.dayOfMonth === undefined ? "" : String(r.dayOfMonth), daysAfterEnd: "" };
}

/** The rule a form describes, or why it is not valid. */
export function formToDueRule(f: DueRuleForm): { ok: true; rule: DueRule } | { ok: false; error: string } {
  const whole = (s: string) => /^\d+$/.test(s.trim());
  let rule: DueRule;
  if (f.period === "event" || f.mode === "days") {
    if (!whole(f.daysAfterEnd)) return { ok: false, error: "Enter the number of days after the " + (f.period === "event" ? "event" : "period ends") + " (a whole number, 0 or more)." };
    rule = { period: f.period, daysAfterEnd: Number(f.daysAfterEnd) };
  } else {
    if (!whole(f.monthsAfterEnd)) return { ok: false, error: "Enter how many months after the period ends (a whole number, 0 or more)." };
    rule = { period: f.period, monthsAfterEnd: Number(f.monthsAfterEnd) };
    const d = f.dayOfMonth.trim();
    if (d) {
      if (d.toLowerCase() === "last") rule.dayOfMonth = "last";
      else if (whole(d) && Number(d) >= 1 && Number(d) <= 32) rule.dayOfMonth = Number(d);
      else return { ok: false, error: 'The day of the month must be 1 to 32, or "last".' };
    }
  }
  try {
    assertValidDueRule(rule);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That due date rule is not valid." };
  }
  return { ok: true, rule };
}

/** Parses the applicability text an administrator typed (empty = every organization). */
export function parseApplicability(text: string): { ok: true; condition: Condition | null } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, condition: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The conditions are not valid JSON. Leave the box empty for every organization." };
  }
  try {
    assertValidCondition(parsed);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Those conditions are not valid." };
  }
  return { ok: true, condition: parsed };
}
