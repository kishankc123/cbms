import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceAuthorities, complianceEntityTypes, complianceTaxTypes } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";

// The three lists a country is set up with: company types, taxes and authorities. They share the same shape (a key
// that never changes, a name, and active or not), so one set of functions serves all of them.

export const SETUP_SECTIONS = {
  "company-types": { title: "Company types", singular: "company type", table: complianceEntityTypes },
  taxes: { title: "Taxes", singular: "tax", table: complianceTaxTypes },
  authorities: { title: "Authorities", singular: "authority", table: complianceAuthorities },
} as const;
export type SetupSection = keyof typeof SETUP_SECTIONS;
export const isSetupSection = (s: string): s is SetupSection => s in SETUP_SECTIONS;

// Every one of the three tables has these columns; taxes also have the authority and "registrable" columns.
type Shared = typeof complianceAuthorities;
const tableOf = (section: SetupSection) => SETUP_SECTIONS[section].table as unknown as Shared;
export type SetupRow = { id: string; key: string; name: string; isActive: boolean; authorityKey?: string | null; isRegistrable?: boolean };

/** What every country starts with: VAT and Income tax. Anything else is added by hand. */
export const DEFAULT_TAX_TYPES = [
  { key: "vat", name: "VAT", isRegistrable: true, amountSource: "vat_return", payableAccountName: "Tax Payable (Output VAT)", legacyPayableCode: "2100" },
  { key: "income_tax", name: "Income Tax", isRegistrable: false, payableAccountName: "Income Tax Liability" },
] as const;

type Result = { ok: true } | { ok: false; error: string };

export async function listSetup(code: string, section: SetupSection) {
  const t = tableOf(section);
  const [rows, authorities] = await Promise.all([
    db.select().from(t).where(eq(t.countryCode, code)).orderBy(asc(t.name)) as Promise<SetupRow[]>,
    section === "taxes" ? db.select({ key: complianceAuthorities.key, name: complianceAuthorities.name }).from(complianceAuthorities).where(eq(complianceAuthorities.countryCode, code)).orderBy(asc(complianceAuthorities.name)) : [],
  ]);
  return { rows, authorities };
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";

export async function addSetupItem(adminId: string, code: string, section: SetupSection, input: { name: string; authorityKey?: string | null; isRegistrable?: boolean }): Promise<Result> {
  const t = tableOf(section);
  const name = input.name.trim();
  if (!name) return { ok: false, error: `Enter the name of the ${SETUP_SECTIONS[section].singular}.` };
  if (name.length > 80) return { ok: false, error: "That name is too long. Keep it under 80 characters." };
  const existing = await db.select({ key: t.key, name: t.name }).from(t).where(eq(t.countryCode, code));
  if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `"${name}" is already in the list.` };
  const taken = new Set(existing.map((e) => e.key));
  let key = slug(name);
  for (let n = 2; taken.has(key); n++) key = `${slug(name)}_${n}`;
  const extra = section === "taxes" ? { authorityKey: input.authorityKey || null, isRegistrable: Boolean(input.isRegistrable) } : {};
  await db.insert(t).values({ countryCode: code, key, name, ...extra } as typeof t.$inferInsert);
  await logAuditEvent({ userId: adminId, action: "country_setup_added", entityType: "country", entityId: code, after: { section, key, name } });
  return { ok: true };
}

export async function updateSetupItem(adminId: string, section: SetupSection, id: string, input: { name?: string; authorityKey?: string | null; isActive?: boolean }): Promise<Result> {
  const t = tableOf(section);
  const [row] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) return { ok: false, error: "That item no longer exists." };
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "The name can't be empty." };
    if (name.length > 80) return { ok: false, error: "That name is too long. Keep it under 80 characters." };
    const others = await db.select({ name: t.name, id: t.id }).from(t).where(eq(t.countryCode, row.countryCode));
    if (others.some((o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `"${name}" is already in the list.` };
    set.name = name;
  }
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (section === "taxes" && input.authorityKey !== undefined) set.authorityKey = input.authorityKey || null;
  await db.update(t).set(set as Partial<typeof t.$inferInsert>).where(eq(t.id, id));
  await logAuditEvent({ userId: adminId, action: "country_setup_changed", entityType: "country", entityId: row.countryCode, before: { section, key: row.key, name: row.name, isActive: row.isActive }, after: { section, ...set } });
  return { ok: true };
}

/** Gives a new country its starting taxes. Safe to run again: a tax that is already there is left as it is. */
export async function seedDefaultTaxes(code: string) {
  await db.insert(complianceTaxTypes).values(DEFAULT_TAX_TYPES.map((d, i) => ({ countryCode: code, sortOrder: i, ...d }))).onConflictDoNothing();
}
