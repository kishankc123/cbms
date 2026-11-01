import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceTaxHeads, tenants } from "@/db/schema";
import { getOpenTaxRate } from "@/lib/compliance/tax-rates";
import { headRateKey } from "@/lib/compliance/platform-tax-rate-types";

// Which TDS heading (Rent, Services...) is withheld on payments to an account. The heading is set on an account or its group; the accounts
// below inherit it, and "none" on one of them exempts it. Rates are the platform administrator's: this only says which heading applies.

export const NO_TDS = "none";

type Linkable = { id: string; parentAccountId: string | null; tdsHeadKey: string | null };

/** The heading that applies to an account: its own, or the nearest group above it that has one. null when none applies or it is exempt. */
export function effectiveTdsHead(all: readonly Linkable[], accountId: string): string | null {
  const byId = new Map(all.map((a) => [a.id, a]));
  for (let a = byId.get(accountId), guard = 0; a && guard < 20; a = a.parentAccountId ? byId.get(a.parentAccountId) : undefined, guard++) {
    if (a.tdsHeadKey) return a.tdsHeadKey === NO_TDS ? null : a.tdsHeadKey;
  }
  return null;
}

/** Looks up the heading that applies to any account of the organization (own or inherited). */
export async function tdsHeadLookup(tenantId: string): Promise<(accountId: string) => string | null> {
  const all = await db.select({ id: accounts.id, parentAccountId: accounts.parentAccountId, tdsHeadKey: accounts.tdsHeadKey }).from(accounts).where(eq(accounts.tenantId, tenantId));
  return (accountId) => effectiveTdsHead(all, accountId);
}

export type TdsHead = { key: string; name: string; kind: "rate" | "slabs"; module: string; rate: number | null };

/** The TDS headings of the organization's country, each with the rate it has today (null: none published, or slabs). */
export async function listTdsHeads(tenantId: string): Promise<TdsHead[]> {
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return [];
  const heads = await db
    .select()
    .from(complianceTaxHeads)
    .where(and(eq(complianceTaxHeads.countryCode, tenant.countryCode), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.isActive, true)))
    .orderBy(asc(complianceTaxHeads.sortOrder), asc(complianceTaxHeads.name));
  return Promise.all(
    heads.map(async (h) => ({
      key: h.key,
      name: h.name,
      kind: (h.kind === "slabs" ? "slabs" : "rate") as TdsHead["kind"],
      module: h.module,
      rate: h.kind === "slabs" ? null : (await getOpenTaxRate(tenantId, headRateKey("tds", h.key)))?.rate ?? null,
    }))
  );
}

/** True when `key` is a heading this organization's country offers (or the exemption marker). */
export async function isKnownTdsHead(tenantId: string, key: string): Promise<boolean> {
  return key === NO_TDS || (await listTdsHeads(tenantId)).some((h) => h.key === key);
}
