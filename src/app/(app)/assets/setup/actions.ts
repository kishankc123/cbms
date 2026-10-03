"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetCategories, assetLocations, assetSettings } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { setAccountRole } from "@/lib/compliance/tax-accounts";
import { ASSET_ROLE_DEFINITIONS, type AssetRoleKey } from "@/lib/assets/accounts";
import { ensureAssetSetup, listAssetCategories } from "@/lib/assets/setup";

// Rule problems are RETURNED (not thrown) so the form can show exactly what to fix.
export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

export async function getAssetSetupData() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");

  const { settings, accounts: roleAccounts } = await ensureAssetSetup(session.tenantId);
  const [chart, categories, locations] = await Promise.all([
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, category: accounts.category }).from(accounts).where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true))).orderBy(asc(accounts.code)),
    listAssetCategories(session.tenantId),
    db.select().from(assetLocations).where(eq(assetLocations.tenantId, session.tenantId)).orderBy(asc(assetLocations.name)),
  ]);

  return {
    canEdit: can(session, "assets", "edit"),
    settings: { codePrefix: settings.codePrefix, autoGenerateCode: settings.autoGenerateCode, depreciationFrequency: settings.depreciationFrequency },
    roles: ASSET_ROLE_DEFINITIONS.map((d) => ({ key: d.key, label: d.label, help: d.help, category: d.category, accountId: roleAccounts[d.key].id })),
    chart,
    categories: categories.map((c) => ({ id: c.id, name: c.name, method: c.defaultMethod, lifeYears: c.defaultUsefulLifeYears, residualPercent: Number(c.defaultResidualPercent), isActive: c.isActive })),
    locations: locations.map((l) => ({ id: l.id, name: l.name, isActive: l.isActive })),
  };
}
export type AssetSetupData = Awaited<ReturnType<typeof getAssetSetupData>>;

export async function saveAssetSettings(input: { codePrefix: string; autoGenerateCode: boolean }): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return fail("You don't have permission to change asset settings.");
  const codePrefix = input.codePrefix.trim();
  if (codePrefix.length > 10) return fail("The asset code prefix can be at most 10 characters.");
  if (/\s/.test(codePrefix)) return fail("The asset code prefix can't contain spaces.");

  const { settings } = await ensureAssetSetup(session.tenantId);
  await db.update(assetSettings).set({ codePrefix, autoGenerateCode: input.autoGenerateCode, updatedAt: new Date() }).where(eq(assetSettings.id, settings.id));
  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "asset_settings_changed",
    entityType: "asset_settings",
    entityId: settings.id,
    before: { codePrefix: settings.codePrefix, autoGenerateCode: settings.autoGenerateCode },
    after: { codePrefix, autoGenerateCode: input.autoGenerateCode },
  });
  revalidatePath("/assets", "layout");
  return { ok: true };
}

export async function saveAssetAccounts(input: Partial<Record<AssetRoleKey, string>>): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return fail("You don't have permission to change asset accounts.");

  const { accounts: current } = await ensureAssetSetup(session.tenantId);
  const chart = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name, category: accounts.category, isActive: accounts.isActive }).from(accounts).where(eq(accounts.tenantId, session.tenantId));
  const byId = new Map(chart.map((a) => [a.id, a]));

  const next = new Map<AssetRoleKey, string>();
  for (const def of ASSET_ROLE_DEFINITIONS) {
    const id = input[def.key] ?? current[def.key].id;
    const account = byId.get(id);
    if (!account) return fail(`Choose an account for "${def.label}".`);
    if (!account.isActive) return fail(`"${account.code} — ${account.name}" is inactive; choose an active account for "${def.label}".`);
    if (account.category !== def.category) return fail(`"${def.label}" must be ${/^[aeiou]/.test(def.category) ? "an" : "a"} ${def.category} account.`);
    next.set(def.key, id);
  }
  if (next.get("asset_cost") === next.get("asset_accum_dep")) return fail("The fixed asset account and the accumulated depreciation account must be different accounts.");
  if (next.get("asset_dep_expense") === next.get("asset_disposal_loss")) return fail("The depreciation expense account and the loss on disposal account must be different accounts.");

  const changed = ASSET_ROLE_DEFINITIONS.filter((d) => next.get(d.key) !== current[d.key].id);
  for (const def of changed) await setAccountRole(session.tenantId, def.key, next.get(def.key)!);
  if (changed.length > 0) {
    await logAuditEvent({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "asset_accounts_changed",
      entityType: "asset_settings",
      before: Object.fromEntries(changed.map((d) => [d.key, current[d.key].code])),
      after: Object.fromEntries(changed.map((d) => [d.key, byId.get(next.get(d.key)!)!.code])),
    });
  }
  revalidatePath("/assets", "layout");
  revalidatePath("/chart-of-accounts", "layout");
  return { ok: true };
}

export type CategoryInput = { id?: string; name: string; method: "straight_line" | "declining_balance" | "none"; lifeYears: number | null; residualPercent: number; isActive: boolean };

export async function saveAssetCategory(input: CategoryInput): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", input.id ? "edit" : "create")) return fail("You don't have permission to change asset categories.");
  const name = input.name.trim();
  if (!name) return fail("Enter a category name.");
  if (!["straight_line", "declining_balance", "none"].includes(input.method)) return fail("Choose a depreciation method.");
  const depreciated = input.method !== "none";
  if (depreciated && !(Number.isInteger(input.lifeYears) && input.lifeYears! >= 1 && input.lifeYears! <= 100)) return fail("Enter the useful life in whole years (1–100).");
  if (!(input.residualPercent >= 0 && input.residualPercent <= 100)) return fail("The residual value must be between 0% and 100% of cost.");

  const values = { name, defaultMethod: input.method, defaultUsefulLifeYears: depreciated ? input.lifeYears : null, defaultResidualPercent: String(depreciated ? input.residualPercent : 0), isActive: input.isActive };
  try {
    if (input.id) {
      const [before] = await db.select().from(assetCategories).where(and(eq(assetCategories.id, input.id), eq(assetCategories.tenantId, session.tenantId))).limit(1);
      if (!before) return fail("Category not found.");
      await db.update(assetCategories).set(values).where(eq(assetCategories.id, before.id));
      await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "asset_category_changed", entityType: "asset_category", entityId: before.id, before: { name: before.name, method: before.defaultMethod, lifeYears: before.defaultUsefulLifeYears, isActive: before.isActive }, after: values });
    } else {
      const existing = await listAssetCategories(session.tenantId);
      const [created] = await db.insert(assetCategories).values({ tenantId: session.tenantId, ...values, sortOrder: existing.length }).returning();
      await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "asset_category_added", entityType: "asset_category", entityId: created.id, after: values });
    }
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`A category named "${name}" already exists.`);
    throw e;
  }
  revalidatePath("/assets", "layout");
  return { ok: true };
}

export async function saveAssetLocation(input: { id?: string; name: string; isActive: boolean }): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", input.id ? "edit" : "create")) return fail("You don't have permission to change asset locations.");
  const name = input.name.trim();
  if (!name) return fail("Enter a location name.");

  try {
    if (input.id) {
      const [before] = await db.select().from(assetLocations).where(and(eq(assetLocations.id, input.id), eq(assetLocations.tenantId, session.tenantId))).limit(1);
      if (!before) return fail("Location not found.");
      await db.update(assetLocations).set({ name, isActive: input.isActive }).where(eq(assetLocations.id, before.id));
      await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "asset_location_changed", entityType: "asset_location", entityId: before.id, before: { name: before.name, isActive: before.isActive }, after: { name, isActive: input.isActive } });
    } else {
      const [created] = await db.insert(assetLocations).values({ tenantId: session.tenantId, name, isActive: input.isActive }).returning();
      await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "asset_location_added", entityType: "asset_location", entityId: created.id, after: { name } });
    }
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`A location named "${name}" already exists.`);
    throw e;
  }
  revalidatePath("/assets", "layout");
  return { ok: true };
}
