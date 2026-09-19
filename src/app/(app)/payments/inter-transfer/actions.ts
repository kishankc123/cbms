"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, lte, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { interTransfers, accounts, journalLines } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import {
  createTransfer as createEngine,
  updateTransfer as updateEngine,
  voidTransfer as voidEngine,
  getTransferAccountOptions,
  getAccountLedgerBalance,
  type TransferInput,
} from "@/lib/ledger/inter-transfers";

function refresh() {
  revalidatePath("/payments/inter-transfer");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export async function getTransferFormOptions() {
  const session = await requireTenantSession();
  return getTransferAccountOptions(session.tenantId);
}

export async function getSourceBalance(accountId: string) {
  const session = await requireTenantSession();
  return getAccountLedgerBalance(session.tenantId, accountId);
}

export async function createInterTransfer(input: TransferInput) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) throw new Error("Not permitted");
  const row = await createEngine(session.tenantId, session.userId, input);
  refresh();
  return { id: row.id, transferNumber: row.transferNumber };
}

export async function updateInterTransfer(transferId: string, input: TransferInput) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "edit")) throw new Error("Not permitted");
  await updateEngine(session.tenantId, session.userId, transferId, input);
  refresh();
}

export async function voidInterTransfer(transferId: string, reason: string) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "delete")) throw new Error("Not permitted");
  if (!reason.trim()) throw new Error("A void reason is required.");
  await voidEngine(session.tenantId, session.userId, transferId, reason.trim());
  refresh();
}

export type TransferListFilters = {
  search?: string;
  from?: string;
  to?: string;
  fromAccountId?: string;
  toAccountId?: string;
  minAmount?: number;
  maxAmount?: number;
};

export async function listInterTransfers(filters: TransferListFilters) {
  const session = await requireTenantSession();

  const conditions = [eq(interTransfers.tenantId, session.tenantId)];
  if (filters.from) conditions.push(gte(interTransfers.transferDate, filters.from));
  if (filters.to) conditions.push(lte(interTransfers.transferDate, filters.to));
  if (filters.fromAccountId) conditions.push(eq(interTransfers.fromAccountId, filters.fromAccountId));
  if (filters.toAccountId) conditions.push(eq(interTransfers.toAccountId, filters.toAccountId));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(or(ilike(interTransfers.transferNumber, term), ilike(interTransfers.reference, term))!);
  }

  const [rows, accountRows] = await Promise.all([
    db.select().from(interTransfers).where(and(...conditions)).orderBy(desc(interTransfers.transferDate), desc(interTransfers.createdAt)),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.tenantId, session.tenantId)),
  ]);
  const nameById = Object.fromEntries(accountRows.map((a) => [a.id, `${a.code} — ${a.name}`]));

  return rows
    .map((r) => ({
      id: r.id,
      transferNumber: r.transferNumber,
      transferDate: r.transferDate,
      fromAccount: nameById[r.fromAccountId] ?? "—",
      toAccount: nameById[r.toAccountId] ?? "—",
      amount: Number(r.amount),
      reference: r.reference,
      status: r.status,
    }))
    .filter((r) => (filters.minAmount === undefined || r.amount >= filters.minAmount) && (filters.maxAmount === undefined || r.amount <= filters.maxAmount));
}

export async function getInterTransferDetail(transferId: string) {
  const session = await requireTenantSession();
  const [t] = await db.select().from(interTransfers).where(and(eq(interTransfers.id, transferId), eq(interTransfers.tenantId, session.tenantId))).limit(1);
  if (!t) return null;

  const [accountRows, lines] = await Promise.all([
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.tenantId, session.tenantId)),
    db.select().from(journalLines).where(eq(journalLines.journalEntryId, t.journalEntryId)),
  ]);
  const nameById = Object.fromEntries(accountRows.map((a) => [a.id, `${a.code} — ${a.name}`]));

  return {
    ...t,
    amount: Number(t.amount),
    fromAccountName: nameById[t.fromAccountId] ?? "—",
    toAccountName: nameById[t.toAccountId] ?? "—",
    entryLines: lines
      .map((l) => ({ accountName: nameById[l.accountId] ?? "—", debit: Number(l.debitAmount), credit: Number(l.creditAmount) }))
      .sort((a, b) => b.debit - a.debit),
  };
}
