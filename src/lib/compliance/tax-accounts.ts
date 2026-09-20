import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts, complianceTaxTypes, tenants } from "@/db/schema";
import { createSubAccount, findControlAccount } from "@/lib/ledger/control-accounts";

// Every tax that can be owed gets its own sub-account under one "Taxes Payable"
// group (Current liabilities), one per tax type: VAT, VAT fines & penalties,
// TDS, Excise... Code that needs one asks for its ROLE ("tax_payable:vat"), so
// the account behind a role can be changed later without touching callers.

export const TAX_PAYABLE_GROUP_ROLE = "tax_payable_group";
export const taxPayableRole = (taxTypeKey: string) => `tax_payable:${taxTypeKey}`;

// Deliberately not "Tax Payable…": some older lookups fall back to a name search
// for "Tax Payable", and the group must never be mistaken for the VAT account.
const GROUP_NAME = "Taxes Payable";
const GROUP_CODE = "2090";

type Account = typeof accounts.$inferSelect;

export async function getAccountByRole(tenantId: string, roleKey: string): Promise<Account | null> {
  const [row] = await db
    .select({ account: accounts })
    .from(accountRoles)
    .innerJoin(accounts, eq(accounts.id, accountRoles.accountId))
    .where(and(eq(accountRoles.tenantId, tenantId), eq(accountRoles.roleKey, roleKey)))
    .limit(1);
  return row?.account ?? null;
}

export async function setAccountRole(tenantId: string, roleKey: string, accountId: string) {
  await db
    .insert(accountRoles)
    .values({ tenantId, roleKey, accountId })
    .onConflictDoUpdate({ target: [accountRoles.tenantId, accountRoles.roleKey], set: { accountId, updatedAt: new Date() } });
}

export async function ensureTaxPayableGroup(tenantId: string): Promise<Account> {
  const mapped = await getAccountByRole(tenantId, TAX_PAYABLE_GROUP_ROLE);
  if (mapped) return mapped;

  const existing = await findControlAccount(tenantId, [GROUP_CODE], GROUP_NAME);
  const group =
    existing ??
    (
      await db
        .insert(accounts)
        .values({ tenantId, code: GROUP_CODE, name: GROUP_NAME, category: "liability", subCategory: "Current liabilities" })
        .returning()
    )[0];
  await setAccountRole(tenantId, TAX_PAYABLE_GROUP_ROLE, group.id);
  return group;
}

async function taxTypesOf(tenantId: string) {
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");
  return db.select().from(complianceTaxTypes).where(and(eq(complianceTaxTypes.countryCode, tenant.countryCode), eq(complianceTaxTypes.isActive, true)));
}

/** Nests an existing account under the group (only if it has no parent yet — a customised chart is left alone). */
async function nestUnderGroup(account: Account, group: Account) {
  if (account.parentAccountId || account.id === group.id) return;
  await db.update(accounts).set({ parentAccountId: group.id }).where(eq(accounts.id, account.id));
}

/**
 * Sets up the Taxes Payable group and adopts the payable accounts that already
 * exist (VAT 2100, TDS 2320) as its children with their roles. It creates no new
 * tax accounts: those are created on demand by `ensureTaxPayableAccount`.
 * Balances and codes are untouched, so postings and reports keep working.
 */
export async function ensureTaxPayableStructure(tenantId: string) {
  const group = await ensureTaxPayableGroup(tenantId);
  for (const type of await taxTypesOf(tenantId)) {
    if (!type.payableAccountName || !type.legacyPayableCode) continue;
    const existing = await findControlAccount(tenantId, [type.legacyPayableCode], type.payableAccountName);
    if (!existing) continue;
    await nestUnderGroup(existing, group);
    if (!(await getAccountByRole(tenantId, taxPayableRole(type.key)))) await setAccountRole(tenantId, taxPayableRole(type.key), existing.id);
  }
}

/** The payable account for a tax type, created under the Taxes Payable group if it does not exist yet. */
export async function ensureTaxPayableAccount(tenantId: string, taxTypeKey: string): Promise<Account | null> {
  const mapped = await getAccountByRole(tenantId, taxPayableRole(taxTypeKey));
  if (mapped) return mapped;

  const type = (await taxTypesOf(tenantId)).find((t) => t.key === taxTypeKey);
  if (!type?.payableAccountName) return null;

  const group = await ensureTaxPayableGroup(tenantId);
  const legacy = type.legacyPayableCode ? await findControlAccount(tenantId, [type.legacyPayableCode], type.payableAccountName) : null;
  const account =
    legacy ??
    (type.legacyPayableCode
      ? (
          // Keeps the long-standing code (e.g. 2320) so code-based lookups elsewhere still find it.
          await db
            .insert(accounts)
            .values({ tenantId, code: type.legacyPayableCode, name: type.payableAccountName, category: "liability", subCategory: "Current liabilities", parentAccountId: group.id })
            .returning()
        )[0]
      : await createSubAccount(tenantId, group, type.payableAccountName));
  await nestUnderGroup(account, group);
  await setAccountRole(tenantId, taxPayableRole(taxTypeKey), account.id);
  return account;
}

const PENALTY_EXPENSE_ROLE = "tax_penalty_expense";

/** The expense account fines, penalties, interest and assessments are charged to unless another is chosen. */
export async function getOrCreateTaxPenaltyExpenseAccount(tenantId: string): Promise<Account> {
  const mapped = await getAccountByRole(tenantId, PENALTY_EXPENSE_ROLE);
  if (mapped) return mapped;
  const existing = await findControlAccount(tenantId, ["5910"], "Tax Fines & Penalties");
  const account =
    existing ??
    (
      await db
        .insert(accounts)
        .values({ tenantId, code: "5910", name: "Tax Fines & Penalties", category: "expense", subCategory: "Fixed expenses" })
        .returning()
    )[0];
  await setAccountRole(tenantId, PENALTY_EXPENSE_ROLE, account.id);
  return account;
}
