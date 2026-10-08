import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, paymentModeAccounts, paymentModes } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { methodForMode, type PaymentMethod } from "@/lib/payment-mode-rules";

export { methodForMode };

// Payment modes (Cash, Cheque, Bank transfer, Fonepay, Card, Wallet, ...): a mode is linked to the lowest-level accounts of
// the Chart of Accounts that hold that kind of money. A group that has sub-groups is never linked itself: each of its
// sub-groups is. One account can serve several modes (a bank takes cheques, transfers, Fonepay and cards). Transactions keep storing the account, so nothing in the ledger depends on modes. Plain server helpers,
// deliberately not server actions: the actions in settings/payment-modes check the permission first.

export const DEFAULT_PAYMENT_MODES = ["Cash", "Cheque", "Bank transfer", "Fonepay", "Card", "Wallet"] as const;

export type ModeResult = { ok: true; modeId: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

/** A mode's name as it will be stored: trimmed, single spaces. */
export function cleanModeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
export function modeNameProblem(name: string): string | null {
  const n = cleanModeName(name);
  if (!n) return "Give the mode a name.";
  if (n.length > 40) return "The name can be at most 40 characters.";
  return null;
}

export type LinkableAccount = { id: string; code: string; name: string; group: string | null; /** The modes this account is linked to. */ modes: { id: string; name: string }[] };

/**
 * The accounts that can be linked to a mode: active, lowest-level, current-asset accounts (where cash, bank and wallet
 * balances live), leaving out receivables, inventory and tax, which are not ways of paying.
 */
export async function listLinkableAccounts(tenantId: string): Promise<LinkableAccount[]> {
  const child = alias(accounts, "child");
  const parent = alias(accounts, "parent");
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, parentCode: parent.code, parentName: parent.name })
    .from(accounts)
    .leftJoin(parent, eq(parent.id, accounts.parentAccountId))
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.isActive, true),
        eq(accounts.category, "asset"),
        eq(accounts.subCategory, "Current assets"),
        sql`${accounts.code} not like '1100%' and ${accounts.code} not like '1200%' and ${accounts.code} not like '1300%'`,
        notExists(db.select({ one: child.id }).from(child).where(and(eq(child.parentAccountId, accounts.id), eq(child.isActive, true))))
      )
    )
    .orderBy(accounts.code);
  const links = await db
    .select({ accountId: paymentModeAccounts.accountId, modeId: paymentModes.id, modeName: paymentModes.name })
    .from(paymentModeAccounts)
    .innerJoin(paymentModes, eq(paymentModes.id, paymentModeAccounts.modeId))
    .where(eq(paymentModeAccounts.tenantId, tenantId))
    .orderBy(asc(paymentModes.sortOrder));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    group: r.parentCode ? `${r.parentCode} — ${r.parentName}` : null,
    modes: links.filter((l) => l.accountId === r.id).map((l) => ({ id: l.modeId, name: l.modeName })),
  }));
}

export type PaymentModeRow = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  accounts: { id: string; code: string; name: string; /** False when the account has since got sub-groups: those need linking instead. */ usable: boolean }[];
};

export async function listPaymentModes(tenantId: string): Promise<PaymentModeRow[]> {
  const child = alias(accounts, "child");
  const modes = await db.select().from(paymentModes).where(eq(paymentModes.tenantId, tenantId)).orderBy(asc(paymentModes.sortOrder), asc(paymentModes.name));
  const links = await db
    .select({
      modeId: paymentModeAccounts.modeId,
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isActive: accounts.isActive,
      hasChildren: sql<boolean>`exists (select 1 from ${accounts} ${child} where ${child.parentAccountId} = ${accounts.id} and ${child.isActive})`,
    })
    .from(paymentModeAccounts)
    .innerJoin(accounts, eq(accounts.id, paymentModeAccounts.accountId))
    .where(eq(paymentModeAccounts.tenantId, tenantId))
    .orderBy(accounts.code);
  return modes.map((m) => ({
    id: m.id,
    name: m.name,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    accounts: links.filter((l) => l.modeId === m.id).map((l) => ({ id: l.id, code: l.code, name: l.name, usable: l.isActive && !l.hasChildren })),
  }));
}

/** Checks the accounts can be linked: this organization's, lowest level. */
async function checkAccounts(tenantId: string, accountIds: string[]): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const linkable = new Set((await listLinkableAccounts(tenantId)).map((a) => a.id));
  if (accountIds.some((id) => !linkable.has(id))) return "Only lowest-level cash, bank or wallet accounts of this organization can be linked. A group that has sub-groups can't be linked itself: link its sub-groups.";
  return null;
}

export type ModeInput = { name: string; isActive: boolean; accountIds: string[] };

export async function createPaymentMode(tenantId: string, userId: string, input: ModeInput): Promise<ModeResult> {
  const problem = modeNameProblem(input.name);
  if (problem) return fail(problem);
  const accountIds = [...new Set(input.accountIds)];
  const accountProblem = await checkAccounts(tenantId, accountIds);
  if (accountProblem) return fail(accountProblem);

  const name = cleanModeName(input.name);
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${paymentModes.sortOrder}), 0)::int` }).from(paymentModes).where(eq(paymentModes.tenantId, tenantId));
  let mode;
  try {
    [mode] = await db.insert(paymentModes).values({ tenantId, name, isActive: input.isActive, sortOrder: n + 1 }).returning({ id: paymentModes.id });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`There is already a mode called "${name}".`);
    throw e;
  }
  if (accountIds.length > 0) {
    await db.insert(paymentModeAccounts).values(accountIds.map((accountId) => ({ tenantId, modeId: mode.id, accountId })));
  }
  await logAuditEvent({ tenantId, userId, action: "payment_mode_created", entityType: "payment_mode", entityId: mode.id, after: { name, accounts: accountIds.length } });
  return { ok: true, modeId: mode.id };
}

export async function updatePaymentMode(tenantId: string, userId: string, modeId: string, input: ModeInput): Promise<ModeResult> {
  const [existing] = await db.select().from(paymentModes).where(and(eq(paymentModes.id, modeId), eq(paymentModes.tenantId, tenantId))).limit(1);
  if (!existing) return fail("Mode not found.");
  const problem = modeNameProblem(input.name);
  if (problem) return fail(problem);
  const accountIds = [...new Set(input.accountIds)];

  // Links to accounts that are no longer linkable (they have sub-groups now, or were deactivated) can be dropped, but not kept.
  const accountProblem = await checkAccounts(tenantId, accountIds);
  if (accountProblem) return fail(accountProblem);

  const name = cleanModeName(input.name);
  try {
    await db.update(paymentModes).set({ name, isActive: input.isActive }).where(eq(paymentModes.id, modeId));
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`There is already a mode called "${name}".`);
    throw e;
  }
  const current = await db.select({ accountId: paymentModeAccounts.accountId }).from(paymentModeAccounts).where(eq(paymentModeAccounts.modeId, modeId));
  const have = new Set(current.map((c) => c.accountId));
  const want = new Set(accountIds);
  const remove = [...have].filter((id) => !want.has(id));
  const add = [...want].filter((id) => !have.has(id));
  if (remove.length > 0) await db.delete(paymentModeAccounts).where(and(eq(paymentModeAccounts.modeId, modeId), inArray(paymentModeAccounts.accountId, remove)));
  if (add.length > 0) {
    await db.insert(paymentModeAccounts).values(add.map((accountId) => ({ tenantId, modeId, accountId })));
  }
  await logAuditEvent({ tenantId, userId, action: "payment_mode_updated", entityType: "payment_mode", entityId: modeId, before: { name: existing.name, isActive: existing.isActive, accounts: have.size }, after: { name, isActive: input.isActive, accounts: want.size } });
  return { ok: true, modeId };
}

/** Deleting a mode only removes its links. Transactions store the account, so no history changes. */
export async function deletePaymentMode(tenantId: string, userId: string, modeId: string): Promise<ModeResult> {
  const [existing] = await db.select().from(paymentModes).where(and(eq(paymentModes.id, modeId), eq(paymentModes.tenantId, tenantId))).limit(1);
  if (!existing) return fail("Mode not found.");
  await db.delete(paymentModes).where(eq(paymentModes.id, modeId));
  await logAuditEvent({ tenantId, userId, action: "payment_mode_deleted", entityType: "payment_mode", entityId: modeId, before: { name: existing.name } });
  return { ok: true, modeId };
}

/**
 * The standard modes for a new organization: Cash takes the Cash account and Bank transfer the bank accounts. Existing
 * organizations got the same from the migration. Does nothing when the organization already has modes.
 */
export async function seedPaymentModes(tenantId: string): Promise<void> {
  const [have] = await db.select({ id: paymentModes.id }).from(paymentModes).where(eq(paymentModes.tenantId, tenantId)).limit(1);
  if (have) return;
  const created = await db
    .insert(paymentModes)
    .values(DEFAULT_PAYMENT_MODES.map((name, i) => ({ tenantId, name, sortOrder: i + 1 })))
    .returning({ id: paymentModes.id, name: paymentModes.name });
  const modeId = new Map(created.map((m) => [m.name, m.id]));
  for (const a of await listLinkableAccounts(tenantId)) {
    const mode = a.code === "1000" ? "Cash" : a.code === "1010" || a.code.startsWith("1010.") ? "Bank transfer" : null;
    if (mode) await db.insert(paymentModeAccounts).values({ tenantId, modeId: modeId.get(mode)!, accountId: a.id });
  }
}

export type ModeOption = { id: string; name: string; accounts: { id: string; code: string; name: string }[] };

/** What a payment screen offers: each active mode with the accounts it can use. Modes with nothing usable linked are left out. */
export async function listModeOptions(tenantId: string): Promise<ModeOption[]> {
  const modes = await listPaymentModes(tenantId);
  return modes
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, name: m.name, accounts: m.accounts.filter((a) => a.usable).map((a) => ({ id: a.id, code: a.code, name: a.name })) }))
    .filter((m) => m.accounts.length > 0);
}

/** Every account that some active mode can use, for the checks that a payment goes through a real cash/bank/wallet account. */
export async function modeAccountIds(tenantId: string): Promise<Set<string>> {
  return new Set((await listModeOptions(tenantId)).flatMap((m) => m.accounts.map((a) => a.id)));
}

export type ResolvedMode = { paymentModeId: string | null; paymentModeName: string | null; paymentMethod: PaymentMethod };

/**
 * What to store on a payment record for the mode the person picked. No mode (older screens, imports that name only an
 * account) keeps the record as it was: no mode, method "cash". A mode must be this organization's, active, and linked to the
 * account used, otherwise the payment is refused: the browser is never trusted for this.
 */
export async function resolvePaymentMode(tenantId: string, modeId: string | null | undefined, accountId: string): Promise<ResolvedMode> {
  if (!modeId) return { paymentModeId: null, paymentModeName: null, paymentMethod: "cash" };
  const [row] = await db
    .select({ id: paymentModes.id, name: paymentModes.name })
    .from(paymentModes)
    .innerJoin(paymentModeAccounts, eq(paymentModeAccounts.modeId, paymentModes.id))
    .where(and(eq(paymentModes.id, modeId), eq(paymentModes.tenantId, tenantId), eq(paymentModes.isActive, true), eq(paymentModeAccounts.accountId, accountId)))
    .limit(1);
  if (!row) throw new Error("That account is not available under the chosen payment mode. Choose the mode and account again.");
  return { paymentModeId: row.id, paymentModeName: row.name, paymentMethod: methodForMode(row.name) };
}

/**
 * For the lines of a journal entry that name a payment mode: checks each (mode, account) pair is real for this organization
 * and returns the mode names to store with the lines. Lines without a mode are left alone.
 */
export async function modeNamesForLines(tenantId: string, lines: { accountId: string; paymentModeId?: string | null }[]): Promise<Map<string, string>> {
  const pairs = lines.filter((l) => l.paymentModeId).map((l) => ({ modeId: l.paymentModeId as string, accountId: l.accountId }));
  const names = new Map<string, string>();
  if (pairs.length === 0) return names;
  const modeIds = [...new Set(pairs.map((p) => p.modeId))];
  const rows = await db
    .select({ id: paymentModes.id, name: paymentModes.name, accountId: paymentModeAccounts.accountId })
    .from(paymentModes)
    .innerJoin(paymentModeAccounts, eq(paymentModeAccounts.modeId, paymentModes.id))
    .where(and(eq(paymentModes.tenantId, tenantId), inArray(paymentModes.id, modeIds)));
  const linked = new Set(rows.map((r) => `${r.id}|${r.accountId}`));
  for (const p of pairs) {
    if (!linked.has(`${p.modeId}|${p.accountId}`)) throw new Error("That account is not available under the chosen payment mode. Choose the mode and account again.");
  }
  for (const r of rows) names.set(r.id, r.name);
  return names;
}

export type PayAccount = { id: string; code: string; name: string };
export type AccountPick = { accountId: string; modeId: string | null };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * What an import file can mean by a payment cell: an account (by name or code), or a payment mode. An account that belongs to
 * exactly one mode is recorded under that mode; a mode with a single account resolves to that account; a mode with several
 * accounts is ambiguous (the file has to name the account). Every cash/bank/wallet account of the organization is covered.
 */
export async function buildPaymentResolver(tenantId: string) {
  const [groups, modes] = await Promise.all([getCashBankAccounts(tenantId), listModeOptions(tenantId)]);
  const accountsById = new Map<string, PayAccount>();
  for (const g of groups) for (const a of g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }]) accountsById.set(a.id, a);
  for (const m of modes) for (const a of m.accounts) accountsById.set(a.id, a);

  const byText = new Map<string, string>();
  for (const a of accountsById.values()) {
    byText.set(norm(a.name), a.id);
    byText.set(norm(a.code), a.id);
  }
  const modesOf = new Map<string, string[]>();
  for (const m of modes) for (const a of m.accounts) modesOf.set(a.id, [...(modesOf.get(a.id) ?? []), m.id]);
  const modeByName = new Map(modes.map((m) => [norm(m.name), m]));

  return {
    accounts: [...accountsById.values()].sort((a, b) => a.code.localeCompare(b.code)),
    modes,
    /** The account (and mode) a cell means; "ambiguous" with the mode's account names when a mode has several; null when unknown. */
    resolve(text: string): AccountPick | { ambiguous: string[] } | null {
      const key = norm(text);
      const accountId = byText.get(key);
      if (accountId) {
        const m = modesOf.get(accountId) ?? [];
        return { accountId, modeId: m.length === 1 ? m[0] : null };
      }
      const mode = modeByName.get(key);
      if (mode) return mode.accounts.length === 1 ? { accountId: mode.accounts[0].id, modeId: mode.id } : { ambiguous: mode.accounts.map((a) => a.name) };
      return null;
    },
  };
}
export type PaymentResolver = Awaited<ReturnType<typeof buildPaymentResolver>>;
