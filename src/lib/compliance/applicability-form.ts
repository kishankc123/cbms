import type { Condition } from "./engine/applicability";

// "Who it applies to", as plain choices instead of a condition written in code. A requirement applies to everyone, or to the
// organizations that match all (or any) of a few conditions like "is registered for VAT". The stored shape is still the engine's
// condition tree; this module turns one into the other. A rule too detailed for these choices is kept as it is and only described.

export type RowKind = "registered" | "filing" | "employees" | "withholds" | "companyType";
/** One condition. `not` flips it ("is not registered for"); `value` is the tax, the filing basis or the company types it names. */
export type Row = { kind: RowKind; not: boolean; value: string[] };
export type Applies = { match: "all" | "any"; rows: Row[] };

/** The choices in the dropdown for a condition, in the words a person would use. */
export const ROW_CHOICES: { kind: RowKind; not: boolean; label: string }[] = [
  { kind: "registered", not: false, label: "Is registered for" },
  { kind: "registered", not: true, label: "Is not registered for" },
  { kind: "filing", not: false, label: "Files VAT" },
  { kind: "filing", not: true, label: "Does not file VAT" },
  { kind: "employees", not: false, label: "Has employees" },
  { kind: "employees", not: true, label: "Has no employees" },
  { kind: "withholds", not: false, label: "Withholds tax at source" },
  { kind: "withholds", not: true, label: "Does not withhold tax at source" },
  { kind: "companyType", not: false, label: "Company type is" },
  { kind: "companyType", not: true, label: "Company type is not" },
];

export const FILING_BASES = [
  { value: "monthly", label: "monthly" },
  { value: "quarterly", label: "quarterly" },
];

export const EVERYONE: Applies = { match: "all", rows: [] };

type Leaf = { fact: string; op: string; value: unknown };
const isLeaf = (c: unknown): c is Leaf => typeof c === "object" && c !== null && "fact" in c;
const flag = (kind: RowKind, c: Leaf, not: boolean): Row | null => (c.op === "eq" && typeof c.value === "boolean" ? { kind, not: not !== (c.value === false), value: [] } : null);

function leafToRow(c: unknown, not = false): Row | null {
  if (typeof c === "object" && c !== null && "not" in c && !not) return leafToRow((c as { not: unknown }).not, true);
  if (!isLeaf(c)) return null;
  if (c.fact === "registered_tax_types" && c.op === "includes" && typeof c.value === "string") return { kind: "registered", not, value: [c.value] };
  if (c.fact === "vat_filing_frequency" && (c.op === "eq" || c.op === "neq") && typeof c.value === "string") return { kind: "filing", not: not !== (c.op === "neq"), value: [c.value] };
  if (c.fact === "has_employees") return flag("employees", c, not);
  if (c.fact === "withholds_tax") return flag("withholds", c, not);
  if (c.fact === "entity_type") {
    if (c.op === "in" && Array.isArray(c.value)) return { kind: "companyType", not, value: c.value.map(String) };
    if ((c.op === "eq" || c.op === "neq") && typeof c.value === "string") return { kind: "companyType", not: not !== (c.op === "neq"), value: [c.value] };
  }
  return null;
}

/** The choices a condition stands for, or null when it is more detailed than these choices can show. */
export function conditionToApplies(condition: unknown): Applies | null {
  if (condition === null || condition === undefined) return EVERYONE;
  const group = condition as { all?: unknown[]; any?: unknown[] };
  const list = group.all ?? group.any;
  if (Array.isArray(list)) {
    const rows = list.map((c) => leafToRow(c));
    return rows.every((r): r is Row => r !== null) ? { match: group.all ? "all" : "any", rows } : null;
  }
  const row = leafToRow(condition);
  return row ? { match: "all", rows: [row] } : null;
}

function rowToCondition(r: Row): Condition {
  const wrap = (c: Condition): Condition => (r.not ? { not: c } : c);
  switch (r.kind) {
    case "registered":
      return wrap({ fact: "registered_tax_types", op: "includes", value: r.value[0] ?? "" });
    case "filing":
      return { fact: "vat_filing_frequency", op: r.not ? "neq" : "eq", value: r.value[0] ?? "monthly" };
    case "employees":
      return { fact: "has_employees", op: "eq", value: !r.not };
    case "withholds":
      return { fact: "withholds_tax", op: "eq", value: !r.not };
    case "companyType":
      return r.value.length === 1 ? { fact: "entity_type", op: r.not ? "neq" : "eq", value: r.value[0] } : wrap({ fact: "entity_type", op: "in", value: r.value });
  }
}

/** The condition to store (null = every organization). */
export function appliesToCondition(a: Applies): Condition | null {
  if (a.rows.length === 0) return null;
  const conditions = a.rows.map(rowToCondition);
  return conditions.length === 1 ? conditions[0] : a.match === "any" ? { any: conditions } : { all: conditions };
}

/** What is missing before the choices can be saved, or null when they are complete. */
export function appliesProblem(a: Applies): string | null {
  for (const r of a.rows) {
    if (r.kind === "registered" && !r.value[0]) return "Choose the tax the organization has to be registered for.";
    if (r.kind === "companyType" && r.value.length === 0) return "Choose at least one company type.";
  }
  return null;
}
