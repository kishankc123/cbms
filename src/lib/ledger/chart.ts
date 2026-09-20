import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts, journalEntries, journalLines } from "@/db/schema";
import { NORMAL_BALANCE } from "@/db/schema/accounts";
import { logAuditEvent } from "@/lib/audit";
import { categoryForSubCategory } from "./account-sub-categories";
import { descendantIds, isSystemAccount, nextChildCode, rollUpBalances, validateTopLevelCode } from "./chart-rules";

/** A rule of the chart was broken; the message is safe to show to the user. */
export class ChartError extends Error {}

type Account = typeof accounts.$inferSelect;
type Client = Pick<typeof db, "select">;

const round2 = (n: number) => Math.round(n * 100) / 100;

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};
const isForeignKeyViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23503" || x?.cause?.code === "23503";
};

async function loadAccount(tenantId: string, id: string): Promise<Account> {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId))).limit(1);
  if (!a) throw new ChartError("Account not found");
  return a;
}

async function roleAccountIds(tenantId: string): Promise<Set<string>> {
  const rows = await db.select({ id: accountRoles.accountId }).from(accountRoles).where(eq(accountRoles.tenantId, tenantId));
  return new Set(rows.map((r) => r.id));
}

/** Net debit minus credit per account, over every line ever posted (reversals cancel by construction). */
async function netDebits(tenantId: string, accountIds?: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: journalLines.accountId, net: sql<string>`sum(${journalLines.debitAmount}) - sum(${journalLines.creditAmount})`, n: sql<string>`count(*)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), ...(accountIds ? [inArray(journalLines.accountId, accountIds)] : [])))
    .groupBy(journalLines.accountId);
  return new Map(rows.map((r) => [r.id, Number(r.net)]));
}

async function lineCount(tenantId: string, accountIds: string[]): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)));
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------- codes

/**
 * Inserts a child of `parent` with the next free code. If two people race for the
 * same code the database's uniqueness rule rejects the loser, which simply retries.
 */
export async function insertChildAccount(
  tenantId: string,
  parent: Pick<Account, "id" | "code" | "category" | "subCategory">,
  fields: { name: string; isActive?: boolean }
): Promise<Account> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.select({ code: accounts.code }).from(accounts).where(eq(accounts.tenantId, tenantId));
    const code = nextChildCode(existing.map((e) => e.code), parent.code);
    try {
      const [created] = await db
        .insert(accounts)
        .values({ tenantId, code, name: fields.name, category: parent.category, subCategory: parent.subCategory, parentAccountId: parent.id, isActive: fields.isActive ?? true })
        .returning();
      return created;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new ChartError("Could not allocate a new account code. Please try again.");
}

/** Same, but the code is worked out from the tenant's existing codes with any client (e.g. inside a transaction). */
export async function nextChildCodeFor(client: Client, tenantId: string, parentCode: string): Promise<string> {
  const existing = await client.select({ code: accounts.code }).from(accounts).where(eq(accounts.tenantId, tenantId));
  return nextChildCode(existing.map((e) => e.code), parentCode);
}

// ---------------------------------------------------------------- create

export async function createAccountEntry(tenantId: string, userId: string, input: { code: string; name: string; subCategory: string }) {
  const code = input.code.trim();
  const name = input.name.trim();
  const codeError = validateTopLevelCode(code);
  if (codeError) throw new ChartError(codeError);
  if (!name) throw new ChartError("Name is required");
  const category = categoryForSubCategory(input.subCategory);
  if (!category) throw new ChartError("Choose a category");

  const [dup] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code))).limit(1);
  if (dup) throw new ChartError(`An account with code ${code} already exists`);

  let created: Account;
  try {
    [created] = await db.insert(accounts).values({ tenantId, code, name, category, subCategory: input.subCategory }).returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ChartError(`An account with code ${code} already exists`);
    throw e;
  }
  await logAuditEvent({ tenantId, userId, action: "account_created", entityType: "chart_account", entityId: created.id, after: { code, name, category, subCategory: input.subCategory } });
  return created;
}

export async function createSubGroupEntry(tenantId: string, userId: string, input: { parentAccountId: string; name: string }) {
  const name = input.name.trim();
  if (!name) throw new ChartError("Name is required");
  const parent = await loadAccount(tenantId, input.parentAccountId);
  if (!parent.isActive) throw new ChartError("The group is inactive");
  const created = await insertChildAccount(tenantId, parent, { name });
  await logAuditEvent({ tenantId, userId, action: "account_created", entityType: "chart_account", entityId: created.id, after: { code: created.code, name, parent: parent.code } });
  return created;
}

// ---------------------------------------------------------------- update

export async function updateAccountEntry(tenantId: string, userId: string, input: { id: string; name: string; isActive: boolean; subCategory?: string | null }) {
  const account = await loadAccount(tenantId, input.id);
  const name = input.name.trim();
  if (!name) throw new ChartError("Name is required");

  const all = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
  const below = descendantIds(all, account.id);
  const system = isSystemAccount(account, await roleAccountIds(tenantId));
  const patch: { name: string; isActive: boolean; category?: Account["category"]; subCategory?: string } = { name, isActive: input.isActive };

  // ---- category / sub-category
  if (input.subCategory !== undefined && input.subCategory !== null && input.subCategory !== (account.subCategory ?? "")) {
    const category = categoryForSubCategory(input.subCategory);
    if (!category) throw new ChartError("Choose a valid category");
    if (category !== account.category) {
      if (system) throw new ChartError("This is a system account. Its type can't be changed.");
      // Reports classify by type, so moving an account that has history would silently change past reports.
      if ((await lineCount(tenantId, [account.id, ...below])) > 0) {
        throw new ChartError("This account (or one below it) has transactions, so its type can't be changed. Past reports would change.");
      }
      patch.category = category;
    }
    patch.subCategory = input.subCategory;
  }

  // ---- active / inactive
  if (input.isActive !== account.isActive) {
    if (!input.isActive) {
      if (system) throw new ChartError("This is a system account and can't be deactivated.");
      const activeBelow = all.filter((a) => below.includes(a.id) && a.isActive);
      if (activeBelow.length > 0) throw new ChartError("Deactivate its sub-groups first.");
      const net = await netDebits(tenantId, [account.id]);
      if (Math.abs(net.get(account.id) ?? 0) > 0.005) throw new ChartError("This account still has a balance. Clear it before deactivating.");
    } else if (account.parentAccountId) {
      const parent = all.find((a) => a.id === account.parentAccountId);
      if (parent && !parent.isActive) throw new ChartError("Activate the group above it first.");
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(accounts).set(patch).where(and(eq(accounts.id, account.id), eq(accounts.tenantId, tenantId)));
    // Sub-accounts take their group's category and sub-category.
    if ((patch.category || patch.subCategory) && below.length > 0) {
      await tx
        .update(accounts)
        .set({ ...(patch.category ? { category: patch.category } : {}), ...(patch.subCategory ? { subCategory: patch.subCategory } : {}) })
        .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, below)));
    }
  });

  const changed = (k: keyof typeof patch) => patch[k] !== undefined && patch[k] !== (account as Record<string, unknown>)[k];
  const keys = (["name", "isActive", "category", "subCategory"] as const).filter(changed);
  if (keys.length > 0) {
    await logAuditEvent({
      tenantId,
      userId,
      action: "account_updated",
      entityType: "chart_account",
      entityId: account.id,
      before: { code: account.code, ...Object.fromEntries(keys.map((k) => [k, (account as Record<string, unknown>)[k] ?? null])) },
      after: { code: account.code, ...Object.fromEntries(keys.map((k) => [k, patch[k] ?? null])) },
    });
  }
}

// ---------------------------------------------------------------- delete

export async function deleteAccountEntry(tenantId: string, userId: string, id: string) {
  const account = await loadAccount(tenantId, id);
  if (isSystemAccount(account, await roleAccountIds(tenantId))) throw new ChartError("This is a system account and can't be deleted.");
  if ((await lineCount(tenantId, [account.id])) > 0) throw new ChartError("This account has transaction history and can't be deleted. Deactivate it instead.");
  const [child] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, account.id))).limit(1);
  if (child) throw new ChartError("This group has sub-groups and can't be deleted.");

  try {
    await db.delete(accounts).where(and(eq(accounts.id, account.id), eq(accounts.tenantId, tenantId)));
  } catch (e) {
    // A customer, supplier, employee, shareholder, bank account or setting still points at it.
    if (isForeignKeyViolation(e)) throw new ChartError("This account is in use (for example by a customer, supplier, employee, shareholder or bank account) and can't be deleted. Deactivate it instead.");
    throw e;
  }
  await logAuditEvent({ tenantId, userId, action: "account_deleted", entityType: "chart_account", entityId: account.id, before: { code: account.code, name: account.name } });
}

// ---------------------------------------------------------------- balances

export type AccountRow = Account & { own: number; total: number; system: boolean };

/**
 * Every account with its balance, signed to its normal side (assets and expenses
 * positive as debits, the rest as credits). `total` includes all sub-accounts.
 */
export async function listAccountsWithBalances(tenantId: string): Promise<AccountRow[]> {
  const all = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId)).orderBy(asc(accounts.code));
  const net = await netDebits(tenantId);
  const roles = await roleAccountIds(tenantId);
  const rolled = rollUpBalances(all.map((a) => ({ id: a.id, parentAccountId: a.parentAccountId, own: round2(NORMAL_BALANCE[a.category] === "debit" ? net.get(a.id) ?? 0 : -(net.get(a.id) ?? 0)) })));
  return all.map((a) => ({ ...a, own: rolled.get(a.id)!.own, total: rolled.get(a.id)!.total, system: isSystemAccount(a, roles) }));
}
