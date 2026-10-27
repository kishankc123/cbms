import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { complianceAuthorities, complianceCategories, complianceCountries, complianceEntityTypes, complianceObligations, complianceRequirementTemplates, complianceTaxTypes, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import type { CalendarSystem } from "@/lib/calendar";
import { computeDueDate, type DueRule } from "./engine/due-rules";
import { resolveCalendar } from "./engine/generate";
import { describeCondition, describeDueRule, parseApplicability, type ConditionNames } from "./template-rules";

// The requirement templates a platform administrator manages: what each organization has to file and when. A template is shared by
// every organization of the country, so a change reaches every one of them the next time items are generated. Items that were already
// generated keep the due date they were given (a filed item never moves); an administrator may choose to also move the open ones.

export type TemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  categoryKey: string;
  categoryName: string;
  taxTypeKey: string | null;
  taxTypeName: string | null;
  authorityKey: string | null;
  entityTypeKey: string | null;
  entityTypeName: string | null;
  frequency: string;
  periodCalendar: string;
  applicability: unknown;
  applicabilityText: string;
  dueRule: unknown;
  dueRuleText: string;
  activeFrom: string | null;
  activeTo: string | null;
  isActive: boolean;
  isVerified: boolean;
  /** How many items organizations have generated from it so far. */
  generatedItems: number;
};

/** The tax and company type names a condition can be written with. */
const conditionNames = (taxTypes: { key: string; name: string }[], entityTypes: { key: string; name: string }[]): ConditionNames => ({
  taxes: Object.fromEntries(taxTypes.map((t) => [t.key, t.name])),
  entityTypes: Object.fromEntries(entityTypes.map((t) => [t.key, t.name])),
});

export async function listTemplates(countryCode: string): Promise<TemplateRow[]> {
  const [templates, categories, taxTypes, entityTypes, counts] = await Promise.all([
    db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, countryCode)).orderBy(asc(complianceRequirementTemplates.categoryKey), asc(complianceRequirementTemplates.name)),
    db.select().from(complianceCategories),
    db.select().from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, countryCode)),
    db.select().from(complianceEntityTypes).where(eq(complianceEntityTypes.countryCode, countryCode)),
    db.select({ templateId: complianceObligations.templateId, n: count() }).from(complianceObligations).groupBy(complianceObligations.templateId),
  ]);
  const generated = new Map(counts.map((c) => [c.templateId, c.n]));
  return templates.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    categoryKey: t.categoryKey,
    categoryName: categories.find((c) => c.key === t.categoryKey)?.name ?? t.categoryKey,
    taxTypeKey: t.taxTypeKey,
    taxTypeName: t.taxTypeKey ? taxTypes.find((x) => x.key === t.taxTypeKey)?.name ?? t.taxTypeKey : null,
    authorityKey: t.authorityKey,
    entityTypeKey: t.entityTypeKey,
    entityTypeName: t.entityTypeKey ? entityTypes.find((x) => x.key === t.entityTypeKey)?.name ?? t.entityTypeKey : null,
    frequency: t.frequency,
    periodCalendar: t.periodCalendar,
    applicability: t.applicability,
    applicabilityText: describeCondition(t.applicability, conditionNames(taxTypes, entityTypes)),
    dueRule: t.dueRule,
    dueRuleText: describeDueRule(t.dueRule),
    activeFrom: t.activeFrom,
    activeTo: t.activeTo,
    isActive: t.isActive,
    isVerified: t.isVerified,
    generatedItems: generated.get(t.id) ?? 0,
  }));
}

/** What the "Add requirement" form can choose from: every category, and the country's active taxes, authorities and company types. */
export async function templateOptions(countryCode: string) {
  const [categories, taxTypes, authorities, entityTypes] = await Promise.all([
    db.select({ key: complianceCategories.key, name: complianceCategories.name }).from(complianceCategories).orderBy(asc(complianceCategories.sortOrder)),
    db.select({ key: complianceTaxTypes.key, name: complianceTaxTypes.name, isRegistrable: complianceTaxTypes.isRegistrable }).from(complianceTaxTypes).where(and(eq(complianceTaxTypes.countryCode, countryCode), eq(complianceTaxTypes.isActive, true))).orderBy(asc(complianceTaxTypes.name)),
    db.select({ key: complianceAuthorities.key, name: complianceAuthorities.name }).from(complianceAuthorities).where(and(eq(complianceAuthorities.countryCode, countryCode), eq(complianceAuthorities.isActive, true))).orderBy(asc(complianceAuthorities.name)),
    db.select({ key: complianceEntityTypes.key, name: complianceEntityTypes.name }).from(complianceEntityTypes).where(and(eq(complianceEntityTypes.countryCode, countryCode), eq(complianceEntityTypes.isActive, true))).orderBy(asc(complianceEntityTypes.name)),
  ]);
  return { categories, taxTypes, authorities, entityTypes };
}

export type UpdateTemplateInput = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  isVerified: boolean;
  activeFrom: string;
  activeTo: string;
  /** null = no due date (an event-based requirement). */
  dueRule: DueRule | null;
  /** The conditions as JSON text; empty = every organization. */
  applicabilityText: string;
  /** Also give the open (not yet filed) items already generated from this template the new due dates. */
  moveOpenItems: boolean;
};
export type UpdateTemplateResult = { ok: true; changes: { field: string; before: string; after: string }[]; movedItems: number } | { ok: false; error: string };

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());

type Fields = Omit<UpdateTemplateInput, "id" | "moveOpenItems">;

/** The checks a requirement has to pass, whether it is being added or changed. */
function checkFields(input: Fields, frequency: string): { ok: true; name: string; condition: Extract<ReturnType<typeof parseApplicability>, { ok: true }>["condition"] } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the requirement a name." };
  if (input.activeFrom && !isDate(input.activeFrom)) return { ok: false, error: "Enter a valid date for Active from." };
  if (input.activeTo && !isDate(input.activeTo)) return { ok: false, error: "Enter a valid date for Active to." };
  if (input.activeFrom && input.activeTo && input.activeTo < input.activeFrom) return { ok: false, error: "Active to cannot be before Active from." };
  const applicability = parseApplicability(input.applicabilityText);
  if (!applicability.ok) return { ok: false, error: applicability.error };
  if (input.isActive && frequency !== "event_based" && !input.dueRule) return { ok: false, error: "An active requirement needs a due date rule, or nothing can be scheduled." };
  return { ok: true, name, condition: applicability.condition };
}

export type NewTemplateInput = Fields & { countryCode: string; categoryKey: string; taxTypeKey: string; authorityKey: string; entityTypeKey: string; frequency: (typeof complianceRequirementTemplates.$inferInsert)["frequency"] };

/** Adds a requirement. Organizations get items from it the next time items are generated. */
export async function createTemplate(adminId: string, input: NewTemplateInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!["monthly", "quarterly", "annual", "one_time", "event_based"].includes(input.frequency)) return { ok: false, error: "Choose how often it repeats." };
  const checked = checkFields(input, input.frequency);
  if (!checked.ok) return checked;
  const [category] = await db.select({ key: complianceCategories.key }).from(complianceCategories).where(eq(complianceCategories.key, input.categoryKey)).limit(1);
  if (!category) return { ok: false, error: "Choose a category." };
  const taken = new Set((await db.select({ key: complianceRequirementTemplates.key }).from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, input.countryCode))).map((r) => r.key));
  const slug = checked.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "requirement";
  let key = slug;
  for (let n = 2; taken.has(key); n++) key = `${slug}_${n}`;
  await db.insert(complianceRequirementTemplates).values({
    countryCode: input.countryCode,
    categoryKey: input.categoryKey,
    taxTypeKey: input.taxTypeKey || null,
    authorityKey: input.authorityKey || null,
    entityTypeKey: input.entityTypeKey || null,
    key,
    name: checked.name,
    description: input.description.trim() || null,
    frequency: input.frequency,
    applicability: checked.condition,
    dueRule: input.dueRule,
    activeFrom: input.activeFrom || null,
    activeTo: input.activeTo || null,
    isActive: input.isActive,
    isVerified: input.isVerified,
  });
  await logAuditEvent({ tenantId: null, userId: adminId, action: "compliance_requirement_created", entityType: "compliance_requirement", entityId: `${input.countryCode}:${key}`, after: { name: checked.name, category: input.categoryKey, frequency: input.frequency, "Due date": describeDueRule(input.dueRule) } });
  return { ok: true };
}

export async function updateTemplate(adminId: string, input: UpdateTemplateInput): Promise<UpdateTemplateResult> {
  const [t] = await db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.id, input.id)).limit(1);
  if (!t) return { ok: false, error: "That requirement was not found." };
  const checked = checkFields(input, t.frequency);
  if (!checked.ok) return checked;
  const name = checked.name;
  const applicability = { condition: checked.condition };
  const [taxTypes, entityTypes] = await Promise.all([
    db.select({ key: complianceTaxTypes.key, name: complianceTaxTypes.name }).from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, t.countryCode)),
    db.select({ key: complianceEntityTypes.key, name: complianceEntityTypes.name }).from(complianceEntityTypes).where(eq(complianceEntityTypes.countryCode, t.countryCode)),
  ]);
  const names = conditionNames(taxTypes, entityTypes);

  // The database keeps an object's keys in its own order, so compare rules without regard to the order they were written in.
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)])) : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
  const before: Record<string, string> = {
    Name: t.name,
    Description: t.description?.trim() || "—",
    Active: t.isActive ? "Yes" : "No",
    Verified: t.isVerified ? "Yes" : "No",
    "Active from": t.activeFrom ?? "—",
    "Active to": t.activeTo ?? "—",
    "Due date": describeDueRule(t.dueRule),
    "Applies to": describeCondition(t.applicability, names),
  };
  const after: Record<string, string> = {
    Name: name,
    Description: input.description.trim() || "—",
    Active: input.isActive ? "Yes" : "No",
    Verified: input.isVerified ? "Yes" : "No",
    "Active from": input.activeFrom || "—",
    "Active to": input.activeTo || "—",
    "Due date": describeDueRule(input.dueRule),
    "Applies to": describeCondition(applicability.condition, names),
  };
  const changes = Object.keys(after)
    .filter((k) => before[k] !== after[k])
    // A rule that reads the same but is written differently is still a change worth keeping.
    .concat(!same(t.dueRule, input.dueRule) && before["Due date"] === after["Due date"] ? ["Due date"] : [])
    .map((k) => ({ field: k, before: before[k], after: after[k] }));
  const dueChanged = !same(t.dueRule, input.dueRule);
  if (changes.length === 0 && !(dueChanged && input.moveOpenItems)) return { ok: true, changes: [], movedItems: 0 };

  await db
    .update(complianceRequirementTemplates)
    .set({
      name,
      description: input.description.trim() || null,
      isActive: input.isActive,
      isVerified: input.isVerified,
      activeFrom: input.activeFrom || null,
      activeTo: input.activeTo || null,
      dueRule: input.dueRule,
      applicability: applicability.condition,
    })
    .where(eq(complianceRequirementTemplates.id, input.id));

  const movedItems = dueChanged && input.moveOpenItems && input.dueRule ? await moveOpenItems(t.countryCode, { ...t, dueRule: input.dueRule }, input.dueRule) : 0;

  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "compliance_requirement_updated",
    entityType: "compliance_requirement",
    entityId: `${t.countryCode}:${t.key}`,
    before: Object.fromEntries(changes.map((c) => [c.field, c.before])),
    after: { ...Object.fromEntries(changes.map((c) => [c.field, c.after])), ...(input.moveOpenItems && dueChanged ? { "Open items moved": movedItems } : {}) },
  });
  return { ok: true, changes, movedItems };
}

/**
 * Gives the items of this template that nobody has acted on yet (pending or in progress) the due date the new rule works out for
 * their own period. A payment date that simply followed the due date moves with it; one set by hand stays.
 */
async function moveOpenItems(countryCode: string, template: typeof complianceRequirementTemplates.$inferSelect, rule: DueRule): Promise<number> {
  const [country] = await db.select({ cal: complianceCountries.statutoryCalendar }).from(complianceCountries).where(eq(complianceCountries.code, countryCode)).limit(1);
  const statutory: CalendarSystem = country?.cal === "BS" ? "BS" : "AD";
  const rows = await db
    .select({ o: complianceObligations, calendar: tenants.calendarSystem })
    .from(complianceObligations)
    .innerJoin(tenants, eq(tenants.id, complianceObligations.tenantId))
    .where(and(eq(complianceObligations.templateId, template.id), eq(complianceObligations.source, "generated"), inArray(complianceObligations.status, ["pending", "in_progress"])));
  let moved = 0;
  for (const { o, calendar } of rows) {
    if (!o.periodStart || !o.periodEnd || !o.periodKey) continue;
    const cal = resolveCalendar(template, statutory, calendar === "BS" ? "BS" : "AD");
    const due = computeDueDate(rule, { key: o.periodKey, label: o.periodLabel, start: o.periodStart, end: o.periodEnd }, cal);
    if (due === o.dueDate) continue;
    await db
      .update(complianceObligations)
      .set({ dueDate: due, paymentDueDate: o.paymentDueDate === o.dueDate ? due : o.paymentDueDate, updatedAt: new Date() })
      .where(eq(complianceObligations.id, o.id));
    moved++;
  }
  return moved;
}
