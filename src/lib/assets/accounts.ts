import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts } from "@/db/schema";
import { getAccountByRole, setAccountRole } from "@/lib/compliance/tax-accounts";
import { findControlAccount, getOrCreateBroughtForwardAccount } from "@/lib/ledger/control-accounts";

type Account = typeof accounts.$inferSelect;
type Category = Account["category"];

// The accounts the Assets module posts to. Code asks for a ROLE, never a hard-coded account, so an organization can
// point a role at a different account in Assets > Setup without anything else changing.
export const ASSET_ROLES = {
  cost: "asset_cost",
  accumulatedDepreciation: "asset_accum_dep",
  depreciationExpense: "asset_dep_expense",
  gainOnDisposal: "asset_disposal_gain",
  lossOnDisposal: "asset_disposal_loss",
  openingAdjustment: "asset_opening_adjustment",
} as const;
export type AssetRoleKey = (typeof ASSET_ROLES)[keyof typeof ASSET_ROLES];

export type AssetRoleDefinition = {
  key: AssetRoleKey;
  label: string;
  help: string;
  /** The type of account that makes sense for this role, to filter the Setup choices. */
  category: Category;
  preferredCode: string;
  accountName: string;
  subCategory: string;
};

export const ASSET_ROLE_DEFINITIONS: AssetRoleDefinition[] = [
  { key: ASSET_ROLES.cost, label: "Fixed asset account", help: "Debited with an asset's capitalized cost.", category: "asset", preferredCode: "1500", accountName: "Fixed Assets", subCategory: "Fixed assets" },
  { key: ASSET_ROLES.accumulatedDepreciation, label: "Accumulated depreciation account", help: "Credited by each depreciation run. It reduces the asset balance, so it normally carries a credit balance.", category: "asset", preferredCode: "1590", accountName: "Accumulated Depreciation", subCategory: "Fixed assets" },
  { key: ASSET_ROLES.depreciationExpense, label: "Depreciation expense account", help: "Debited by each depreciation run.", category: "expense", preferredCode: "5500", accountName: "Depreciation Expense", subCategory: "Indirect expenses" },
  { key: ASSET_ROLES.gainOnDisposal, label: "Gain on disposal account", help: "Credited when an asset is sold for more than its net book value.", category: "income", preferredCode: "4150", accountName: "Gain on Disposal of Assets", subCategory: "Revenue" },
  { key: ASSET_ROLES.lossOnDisposal, label: "Loss on disposal account", help: "Debited when an asset is sold below its net book value or written off.", category: "expense", preferredCode: "5600", accountName: "Loss on Disposal of Assets", subCategory: "Indirect expenses" },
  { key: ASSET_ROLES.openingAdjustment, label: "Opening asset adjustment account", help: "The balancing side of opening assets brought in from before the books started.", category: "equity", preferredCode: "3200", accountName: "Brought forward", subCategory: "Equity & reserve" },
];

/** The first code from `preferred` upward that no account in this organization uses yet. */
function firstFreeCode(preferred: string, taken: Set<string>): string {
  let n = Number(preferred);
  if (!Number.isInteger(n)) return preferred;
  while (taken.has(String(n))) n++;
  return String(n);
}

async function createDefaultFor(tenantId: string, def: AssetRoleDefinition): Promise<Account> {
  if (def.key === ASSET_ROLES.openingAdjustment) return getOrCreateBroughtForwardAccount(tenantId);
  if (def.key === ASSET_ROLES.cost) {
    const existing = await findControlAccount(tenantId, [def.preferredCode], def.accountName);
    if (existing) return existing;
  }

  // Never hijack an account the organization already uses for something else: reuse one with the same name, else
  // take the first free code.
  const [sameName] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.category, def.category), ilike(accounts.name, def.accountName))).limit(1);
  if (sameName) return sameName;

  const codes = new Set((await db.select({ code: accounts.code }).from(accounts).where(eq(accounts.tenantId, tenantId))).map((r) => r.code));
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: firstFreeCode(def.preferredCode, codes), name: def.accountName, category: def.category, subCategory: def.subCategory })
    .returning();
  return created;
}

/**
 * Makes sure every asset role points at a real account, creating the standard ones an organization doesn't have yet.
 * Idempotent and cheap when everything is already set (one query), so pages can call it freely.
 */
export async function ensureAssetAccounts(tenantId: string): Promise<Record<AssetRoleKey, Account>> {
  const keys = ASSET_ROLE_DEFINITIONS.map((d) => d.key);
  const rows = await db
    .select({ roleKey: accountRoles.roleKey, account: accounts })
    .from(accountRoles)
    .innerJoin(accounts, eq(accounts.id, accountRoles.accountId))
    .where(and(eq(accountRoles.tenantId, tenantId), inArray(accountRoles.roleKey, keys)));
  const mapped = new Map<string, Account>(rows.map((r) => [r.roleKey, r.account]));

  for (const def of ASSET_ROLE_DEFINITIONS) {
    if (mapped.has(def.key)) continue;
    const account = await createDefaultFor(tenantId, def);
    await setAccountRole(tenantId, def.key, account.id);
    mapped.set(def.key, account);
  }
  return Object.fromEntries(ASSET_ROLE_DEFINITIONS.map((d) => [d.key, mapped.get(d.key)!])) as Record<AssetRoleKey, Account>;
}

export async function getAssetAccount(tenantId: string, role: AssetRoleKey): Promise<Account> {
  return (await getAccountByRole(tenantId, role)) ?? (await ensureAssetAccounts(tenantId))[role];
}
