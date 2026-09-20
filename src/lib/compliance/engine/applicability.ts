// Applicability engine: decides whether a requirement template applies to an
// organization, from a small structured condition tree over named FACTS.
//
// Deliberately not an expression language: the operators below are a fixed,
// tested set, and templates are validated when they are seeded. The engine
// knows nothing about any country — "vat", "nepal" and so on only ever appear
// as data in a template, never in this file.

export type Facts = Record<string, string | number | boolean | string[] | null | undefined>;

export type Op = "eq" | "neq" | "in" | "includes" | "gt" | "gte" | "lt" | "lte";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: Op; value: unknown };

const OPS: Op[] = ["eq", "neq", "in", "includes", "gt", "gte", "lt", "lte"];

/** Throws a descriptive error for a malformed condition — used when templates are loaded/seeded. */
export function assertValidCondition(c: unknown, path = "applicability"): asserts c is Condition {
  if (typeof c !== "object" || c === null) throw new Error(`${path}: expected an object`);
  const o = c as Record<string, unknown>;
  if ("all" in o || "any" in o) {
    const list = (o.all ?? o.any) as unknown;
    if (!Array.isArray(list) || list.length === 0) throw new Error(`${path}: "all"/"any" needs a non-empty list`);
    list.forEach((child, i) => assertValidCondition(child, `${path}[${i}]`));
    return;
  }
  if ("not" in o) return assertValidCondition(o.not, `${path}.not`);
  if (typeof o.fact !== "string" || !o.fact) throw new Error(`${path}: missing "fact"`);
  if (!OPS.includes(o.op as Op)) throw new Error(`${path}: unknown operator "${String(o.op)}"`);
  if (!("value" in o)) throw new Error(`${path}: missing "value"`);
  if (o.op === "in" && !Array.isArray(o.value)) throw new Error(`${path}: "in" needs a list value`);
}

function compare(actual: Facts[string], op: Op, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && (expected as unknown[]).includes(actual);
    case "includes":
      return Array.isArray(actual) && actual.includes(expected as string);
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
  }
}

/** null / undefined applicability means "always applies". An unknown fact never matches. */
export function isApplicable(condition: unknown, facts: Facts): boolean {
  if (condition === null || condition === undefined) return true;
  assertValidCondition(condition);
  return evaluate(condition, facts);
}

function evaluate(c: Condition, facts: Facts): boolean {
  if ("all" in c) return c.all.every((x) => evaluate(x, facts));
  if ("any" in c) return c.any.some((x) => evaluate(x, facts));
  if ("not" in c) return !evaluate(c.not, facts);
  return compare(facts[c.fact], c.op, c.value);
}
