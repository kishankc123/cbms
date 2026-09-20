import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, capitalChanges, journalEntries, journalLines, shareLagatEntries, shareholders, tenantCapital } from "@/db/schema";
import { validateADDate } from "@/lib/calendar";
import { logAuditEvent } from "@/lib/audit";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { createPayment, voidPayment, type CreatePaymentResult } from "@/lib/ledger/payments-engine";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { getAccountByRole, setAccountRole } from "@/lib/compliance/tax-accounts";
import { raiseEventObligation } from "@/lib/compliance/engine/generate";
import { proportionalPaid, summarizeOwnership, withinAuthorised } from "./rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const SHARE_CAPITAL_GROUP_ROLE = "share_capital_group";

type Account = typeof accounts.$inferSelect;
type ChangeType = (typeof capitalChanges.$inferInsert)["changeType"];

// ------------------------------------------------------------------ ledger

/**
 * The equity group every shareholder's capital sub-account sits under. It is the
 * chart's existing capital account (3000) — nothing is moved or renamed — and is
 * found through a role, so a customised chart can point the role elsewhere.
 */
export async function ensureShareCapitalGroup(tenantId: string): Promise<Account> {
  const mapped = await getAccountByRole(tenantId, SHARE_CAPITAL_GROUP_ROLE);
  if (mapped) return mapped;
  const existing = await findControlAccount(tenantId, ["3000"], "Owner's Capital");
  const group = existing ?? (await db.insert(accounts).values({ tenantId, code: "3000", name: "Share Capital", category: "equity" }).returning())[0];
  await setAccountRole(tenantId, SHARE_CAPITAL_GROUP_ROLE, group.id);
  return group;
}

/** Credit balance per account: every line ever posted, including reversals (which cancel by construction). */
async function creditBalances(tenantId: string, accountIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(accountIds.map((id) => [id, 0]));
  if (accountIds.length === 0) return out;
  const rows = await db
    .select({ id: journalLines.accountId, net: sql<string>`sum(${journalLines.creditAmount}) - sum(${journalLines.debitAmount})` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)))
    .groupBy(journalLines.accountId);
  for (const r of rows) out.set(r.id, round2(Number(r.net)));
  return out;
}

// ---------------------------------------------------------------- snapshot

export async function getOwnershipSnapshot(tenantId: string) {
  const group = await ensureShareCapitalGroup(tenantId);
  const [capRow] = await db.select().from(tenantCapital).where(eq(tenantCapital.tenantId, tenantId)).limit(1);
  const holderRows = await db.select().from(shareholders).where(eq(shareholders.tenantId, tenantId)).orderBy(asc(shareholders.name));

  const balances = await creditBalances(tenantId, [group.id, ...holderRows.map((h) => h.capitalAccountId).filter((x): x is string => Boolean(x))]);
  const unassigned = balances.get(group.id) ?? 0;
  const holders = holderRows.map((h) => ({ ...h, paid: h.capitalAccountId ? balances.get(h.capitalAccountId) ?? 0 : 0 }));

  const cap = {
    authorisedCapital: Number(capRow?.authorisedCapital ?? 0),
    issuedShares: capRow?.issuedShares ?? 0,
    faceValue: Number(capRow?.faceValue ?? 0),
    currency: capRow?.currency ?? "NPR",
  };
  const summary = summarizeOwnership(cap, holders.map((h) => ({ id: h.id, name: h.name, shares: h.sharesHeld, paid: h.paid, active: h.status === "active" })));
  const byId = new Map(summary.holders.map((h) => [h.id, h]));
  const paidUp = round2(unassigned + holders.reduce((s, h) => s + h.paid, 0));

  const lagat = await db.select().from(shareLagatEntries).where(eq(shareLagatEntries.tenantId, tenantId)).orderBy(desc(shareLagatEntries.createdAt));
  const changes = await db.select().from(capitalChanges).where(eq(capitalChanges.tenantId, tenantId)).orderBy(desc(capitalChanges.effectiveDate), desc(capitalChanges.createdAt));
  const nameOf = new Map(holderRows.map((h) => [h.id, h.name]));

  const warnings: string[] = [];
  if (!capRow) warnings.push("Your capital structure isn't set up yet.");
  if (capRow && cap.issuedShares > 0 && summary.allocationPct < 100) warnings.push(`Ownership allocation is incomplete. Current allocation: ${summary.allocationPct}%.`);
  if (summary.exceedsAuthorised) warnings.push("Issued capital is more than the authorised capital.");
  if (unassigned > 0.005) warnings.push(`${cap.currency} ${fmt(unassigned)} of paid-up capital in your books isn't assigned to a shareholder yet.`);
  if (capRow && paidUp > summary.issuedCapital + 0.005) warnings.push("Paid-up capital in your books is more than issued capital.");
  if (lagat[0]?.status === "update_required") warnings.push("Share Lagat needs to be updated.");

  return {
    capital: { ...cap, exists: Boolean(capRow), issuedCapital: summary.issuedCapital, paidUpCapital: paidUp, unassignedPaid: unassigned },
    ownership: { allocatedShares: summary.allocatedShares, unallocatedShares: summary.unallocatedShares, allocationPct: summary.allocationPct },
    holders: holders.map((h) => {
      const s = byId.get(h.id)!;
      return {
        id: h.id,
        name: h.name,
        holderType: h.holderType,
        shareClass: h.shareClass,
        sharesHeld: h.sharesHeld,
        dateAcquired: h.dateAcquired ?? "",
        status: h.status,
        notes: h.notes ?? "",
        paid: h.paid,
        unpaid: s.unpaid,
        ownershipPct: s.ownershipPct,
      };
    }),
    warnings,
    lagat: {
      current: lagat[0] ? { status: lagat[0].status, lastUpdatedDate: lagat.find((e) => e.status === "updated")?.lastUpdatedDate ?? "", lastChangeDate: lagat[0].lastChangeDate ?? "", reason: lagat[0].reason ?? "" } : null,
      history: lagat.map((e) => ({
        id: e.id,
        status: e.status,
        lastUpdatedDate: e.lastUpdatedDate ?? "",
        lastChangeDate: e.lastChangeDate ?? "",
        reason: e.reason ?? "",
        referenceNumber: e.referenceNumber ?? "",
        supportingDocument: e.supportingDocument ?? "",
        notes: e.notes ?? "",
        isAutomatic: e.isAutomatic,
        createdAt: e.createdAt.toISOString(),
      })),
    },
    changes: changes.map((c) => ({
      id: c.id,
      type: c.changeType,
      date: c.effectiveDate,
      shareholderId: c.shareholderId ?? "",
      toShareholderId: c.toShareholderId ?? "",
      shareholder: c.shareholderId ? nameOf.get(c.shareholderId) ?? "—" : "",
      toShareholder: c.toShareholderId ? nameOf.get(c.toShareholderId) ?? "—" : "",
      shares: c.shares,
      amount: c.amount === null ? null : Number(c.amount),
      previousValue: c.previousValue === null ? null : Number(c.previousValue),
      newValue: c.newValue === null ? null : Number(c.newValue),
      reason: c.reason ?? "",
      referenceNumber: c.referenceNumber ?? "",
      supportingDocument: c.supportingDocument ?? "",
      notes: c.notes ?? "",
    })),
  };
}

// ---------------------------------------------------------------- helpers

type Meta = { effectiveDate: string; reason?: string; referenceNumber?: string; supportingDocument?: string; notes?: string };

const clean = (s?: string) => s?.trim() || null;

function assertDate(d: string, label = "date") {
  if (!validateADDate(d)) throw new Error(`Enter a valid ${label}`);
}
function assertShares(n: number) {
  if (!Number.isInteger(n) || n <= 0) throw new Error("Shares must be a whole number greater than zero");
}

async function loadCapital(tenantId: string) {
  const [row] = await db.select().from(tenantCapital).where(eq(tenantCapital.tenantId, tenantId)).limit(1);
  if (!row) throw new Error("Set up your capital structure first");
  return { authorisedCapital: Number(row.authorisedCapital), issuedShares: row.issuedShares, faceValue: Number(row.faceValue), currency: row.currency };
}

async function loadHolder(tenantId: string, id: string) {
  const [h] = await db.select().from(shareholders).where(and(eq(shareholders.id, id), eq(shareholders.tenantId, tenantId))).limit(1);
  if (!h) throw new Error("Shareholder not found");
  return h;
}

async function paidOf(tenantId: string, holder: { capitalAccountId: string | null }) {
  return holder.capitalAccountId ? (await creditBalances(tenantId, [holder.capitalAccountId])).get(holder.capitalAccountId) ?? 0 : 0;
}

async function recordChange(tenantId: string, userId: string, values: Omit<typeof capitalChanges.$inferInsert, "tenantId" | "createdBy">, lagatReason?: string) {
  const [row] = await db.insert(capitalChanges).values({ ...values, tenantId, createdBy: userId }).returning();
  await logAuditEvent({
    tenantId,
    userId,
    action: "capital_change_recorded",
    entityType: "capital_change",
    entityId: row.id,
    before: values.previousValue !== undefined ? { value: values.previousValue } : undefined,
    after: { type: values.changeType, date: values.effectiveDate, shares: values.shares ?? null, amount: values.amount ?? null, newValue: values.newValue ?? null, reason: values.reason ?? null },
  });
  if (lagatReason) await requireShareLagatUpdate(tenantId, userId, row.id, values.effectiveDate, lagatReason);
  return row;
}

/**
 * Something about the shareholding changed, so the share register (Share Lagat)
 * is out of date until someone updates it. Recorded as its own history entry.
 * If a reviewed, active requirement exists for it, its filing obligation is
 * raised too; otherwise no deadline is invented.
 */
async function requireShareLagatUpdate(tenantId: string, userId: string, changeId: string, date: string, reason: string) {
  await db.insert(shareLagatEntries).values({ tenantId, status: "update_required", lastChangeDate: date, reason, isAutomatic: true, capitalChangeId: changeId, createdBy: userId });
  try {
    await raiseEventObligation(tenantId, "share_lagat_update", { key: changeId, label: reason, date });
  } catch (e) {
    console.error("could not raise Share Lagat obligation", e);
  }
}

// ---------------------------------------------------------------- capital structure

export async function setupCapital(tenantId: string, userId: string, input: Meta & { authorisedCapital: number; issuedShares: number; faceValue: number; currency: string }) {
  assertDate(input.effectiveDate, "effective date");
  if (!(input.faceValue > 0)) throw new Error("Face value per share must be greater than zero");
  if (!(input.authorisedCapital >= 0) || !Number.isInteger(input.issuedShares) || input.issuedShares < 0) throw new Error("Enter valid capital figures");
  if (input.authorisedCapital > 0 && input.issuedShares * input.faceValue > input.authorisedCapital + 0.005) throw new Error("Issued capital can't be more than the authorised capital");
  const [existing] = await db.select().from(tenantCapital).where(eq(tenantCapital.tenantId, tenantId)).limit(1);
  if (existing) throw new Error("Capital is already set up. Record a capital change instead.");

  await ensureShareCapitalGroup(tenantId);
  await db.insert(tenantCapital).values({
    tenantId,
    authorisedCapital: round2(input.authorisedCapital).toFixed(2),
    issuedShares: input.issuedShares,
    faceValue: round2(input.faceValue).toFixed(2),
    currency: input.currency.trim() || "NPR",
  });
  await recordChange(tenantId, userId, {
    changeType: "initial_setup",
    effectiveDate: input.effectiveDate,
    shares: input.issuedShares,
    newValue: round2(input.authorisedCapital).toFixed(2),
    reason: clean(input.reason) ?? "Initial capital structure",
    referenceNumber: clean(input.referenceNumber),
    supportingDocument: clean(input.supportingDocument),
    notes: clean(input.notes) ?? `Face value ${fmt(input.faceValue)}; ${input.issuedShares} shares issued`,
  });
}

export async function increaseAuthorisedCapital(tenantId: string, userId: string, input: Meta & { newAmount: number }) {
  assertDate(input.effectiveDate, "effective date");
  const cap = await loadCapital(tenantId);
  if (!(input.newAmount > cap.authorisedCapital)) throw new Error("The new authorised capital must be higher than the current one");
  await db.update(tenantCapital).set({ authorisedCapital: round2(input.newAmount).toFixed(2), updatedAt: new Date() }).where(eq(tenantCapital.tenantId, tenantId));
  await recordChange(tenantId, userId, {
    changeType: "authorised_capital_increase",
    effectiveDate: input.effectiveDate,
    previousValue: cap.authorisedCapital.toFixed(2),
    newValue: round2(input.newAmount).toFixed(2),
    reason: clean(input.reason),
    referenceNumber: clean(input.referenceNumber),
    supportingDocument: clean(input.supportingDocument),
    notes: clean(input.notes),
  });
}

export async function changeFaceValue(tenantId: string, userId: string, input: Meta & { newFaceValue: number }) {
  assertDate(input.effectiveDate, "effective date");
  const cap = await loadCapital(tenantId);
  if (!(input.newFaceValue > 0)) throw new Error("Face value must be greater than zero");
  if (cap.authorisedCapital > 0 && cap.issuedShares * input.newFaceValue > cap.authorisedCapital + 0.005) throw new Error("At this face value, issued capital would exceed the authorised capital");
  await db.update(tenantCapital).set({ faceValue: round2(input.newFaceValue).toFixed(2), updatedAt: new Date() }).where(eq(tenantCapital.tenantId, tenantId));
  await recordChange(
    tenantId,
    userId,
    {
      changeType: "face_value_change",
      effectiveDate: input.effectiveDate,
      previousValue: cap.faceValue.toFixed(2),
      newValue: round2(input.newFaceValue).toFixed(2),
      reason: clean(input.reason),
      referenceNumber: clean(input.referenceNumber),
      supportingDocument: clean(input.supportingDocument),
      notes: clean(input.notes),
    },
    "Face value per share changed"
  );
}

// ---------------------------------------------------------------- shareholders

export async function addShareholder(
  tenantId: string,
  userId: string,
  input: Meta & { name: string; holderType: string; shareClass: string; shares: number; dateAcquired: string }
) {
  assertDate(input.effectiveDate, "date");
  const name = input.name.trim();
  if (!name) throw new Error("Shareholder name is required");
  if (!Number.isInteger(input.shares) || input.shares < 0) throw new Error("Shares must be a whole number");
  if (input.dateAcquired) assertDate(input.dateAcquired, "date acquired");

  const cap = await loadCapital(tenantId);
  const current = await db.select().from(shareholders).where(eq(shareholders.tenantId, tenantId));
  if (current.some((h) => h.status === "active" && h.name.trim().toLowerCase() === name.toLowerCase())) throw new Error("A shareholder with this name already exists");
  const allocated = current.filter((h) => h.status === "active").reduce((s, h) => s + h.sharesHeld, 0);
  // Adding a holder allocates shares that are already issued; issuing more is a separate, recorded step.
  if (input.shares > cap.issuedShares - allocated) throw new Error(`Only ${cap.issuedShares - allocated} issued shares are unallocated. Issue more shares first.`);

  const group = await ensureShareCapitalGroup(tenantId);
  const holder = await db.transaction(async (tx) => {
    const siblings = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, group.id)));
    const [account] = await tx
      .insert(accounts)
      .values({ tenantId, code: `${group.code}.${String(siblings.length + 1).padStart(2, "0")}`, name, category: group.category, subCategory: group.subCategory, parentAccountId: group.id })
      .returning();
    const [row] = await tx
      .insert(shareholders)
      .values({ tenantId, name, holderType: input.holderType || "individual", shareClass: input.shareClass.trim() || "Ordinary", sharesHeld: input.shares, dateAcquired: input.dateAcquired || input.effectiveDate, notes: clean(input.notes), capitalAccountId: account.id })
      .returning();
    return row;
  });

  await recordChange(
    tenantId,
    userId,
    { changeType: "shareholder_added", effectiveDate: input.effectiveDate, shareholderId: holder.id, shares: input.shares, newValue: String(input.shares), reason: clean(input.reason) ?? "Shareholder added", referenceNumber: clean(input.referenceNumber), supportingDocument: clean(input.supportingDocument), notes: clean(input.notes) },
    `Shareholder added: ${name}`
  );
  return holder;
}

export async function updateShareholder(tenantId: string, userId: string, input: { id: string; name: string; holderType: string; shareClass: string; dateAcquired: string; notes: string }) {
  const h = await loadHolder(tenantId, input.id);
  const name = input.name.trim();
  if (!name) throw new Error("Shareholder name is required");
  if (input.dateAcquired) assertDate(input.dateAcquired, "date acquired");
  const next = { name, holderType: input.holderType || h.holderType, shareClass: input.shareClass.trim() || h.shareClass, dateAcquired: input.dateAcquired || null, notes: clean(input.notes) };

  await db.update(shareholders).set(next).where(eq(shareholders.id, h.id));
  if (name !== h.name && h.capitalAccountId) await db.update(accounts).set({ name }).where(eq(accounts.id, h.capitalAccountId));
  // Details (not shares) change here; the before/after is the history.
  await logAuditEvent({
    tenantId,
    userId,
    action: "shareholder_updated",
    entityType: "shareholder",
    entityId: h.id,
    before: { name: h.name, holderType: h.holderType, shareClass: h.shareClass, dateAcquired: h.dateAcquired, notes: h.notes },
    after: next,
  });
}

export async function deactivateShareholder(tenantId: string, userId: string, id: string, meta: Meta) {
  assertDate(meta.effectiveDate, "date");
  const h = await loadHolder(tenantId, id);
  if (h.status === "inactive") throw new Error("This shareholder is already inactive");
  if (h.sharesHeld > 0) throw new Error("Transfer or cancel this shareholder's shares before marking them inactive");
  if (Math.abs(await paidOf(tenantId, h)) > 0.005) throw new Error("This shareholder still has capital in the books. Transfer it to another shareholder first.");
  await db.update(shareholders).set({ status: "inactive" }).where(eq(shareholders.id, h.id));
  if (h.capitalAccountId) await db.update(accounts).set({ isActive: false }).where(eq(accounts.id, h.capitalAccountId));
  await recordChange(tenantId, userId, { changeType: "shareholder_deactivated", effectiveDate: meta.effectiveDate, shareholderId: h.id, reason: clean(meta.reason) ?? "Marked inactive", referenceNumber: clean(meta.referenceNumber), supportingDocument: clean(meta.supportingDocument), notes: clean(meta.notes) }, `Shareholder marked inactive: ${h.name}`);
}

// ---------------------------------------------------------------- share movements

export async function issueShares(tenantId: string, userId: string, input: Meta & { shareholderId: string; shares: number }) {
  assertDate(input.effectiveDate, "effective date");
  assertShares(input.shares);
  const cap = await loadCapital(tenantId);
  const h = await loadHolder(tenantId, input.shareholderId);
  if (h.status !== "active") throw new Error("This shareholder is inactive");
  if (!withinAuthorised(cap, input.shares)) throw new Error("Issuing these shares would take issued capital above the authorised capital. Increase the authorised capital first.");

  await db.transaction(async (tx) => {
    await tx.update(shareholders).set({ sharesHeld: h.sharesHeld + input.shares }).where(eq(shareholders.id, h.id));
    await tx.update(tenantCapital).set({ issuedShares: cap.issuedShares + input.shares, updatedAt: new Date() }).where(eq(tenantCapital.tenantId, tenantId));
  });
  await recordChange(
    tenantId,
    userId,
    { changeType: "shares_issued", effectiveDate: input.effectiveDate, shareholderId: h.id, shares: input.shares, previousValue: String(cap.issuedShares), newValue: String(cap.issuedShares + input.shares), reason: clean(input.reason) ?? "New shares issued", referenceNumber: clean(input.referenceNumber), supportingDocument: clean(input.supportingDocument), notes: clean(input.notes) },
    `Shares issued to ${h.name}`
  );
}

export async function cancelShares(tenantId: string, userId: string, input: Meta & { shareholderId: string; shares: number }) {
  assertDate(input.effectiveDate, "effective date");
  assertShares(input.shares);
  const cap = await loadCapital(tenantId);
  const h = await loadHolder(tenantId, input.shareholderId);
  if (input.shares > h.sharesHeld) throw new Error(`${h.name} holds only ${h.sharesHeld} shares`);
  // Any capital returned to the holder is a separate payment; this only changes the register.
  await db.transaction(async (tx) => {
    await tx.update(shareholders).set({ sharesHeld: h.sharesHeld - input.shares }).where(eq(shareholders.id, h.id));
    await tx.update(tenantCapital).set({ issuedShares: cap.issuedShares - input.shares, updatedAt: new Date() }).where(eq(tenantCapital.tenantId, tenantId));
  });
  await recordChange(
    tenantId,
    userId,
    { changeType: "share_cancellation", effectiveDate: input.effectiveDate, shareholderId: h.id, shares: input.shares, previousValue: String(cap.issuedShares), newValue: String(cap.issuedShares - input.shares), reason: clean(input.reason) ?? "Shares cancelled", referenceNumber: clean(input.referenceNumber), supportingDocument: clean(input.supportingDocument), notes: clean(input.notes) },
    `Shares cancelled: ${h.name}`
  );
}

/**
 * Moves shares — and the paid capital that goes with them — from one shareholder
 * to another. The ledger entry moves capital between their sub-accounts and the
 * register moves the shares; if the register step fails after the entry posted,
 * the entry is reversed, so the two never end up disagreeing.
 */
export async function transferShares(tenantId: string, userId: string, input: Meta & { fromId: string; toId: string; shares: number; amount: number }) {
  assertDate(input.effectiveDate, "effective date");
  assertShares(input.shares);
  if (input.fromId === input.toId) throw new Error("Choose two different shareholders");
  if (!(input.amount >= 0)) throw new Error("Enter a valid amount");

  const from = await loadHolder(tenantId, input.fromId);
  const to = await loadHolder(tenantId, input.toId);
  if (from.status !== "active" || to.status !== "active") throw new Error("Both shareholders must be active");
  if (input.shares > from.sharesHeld) throw new Error(`${from.name} holds only ${from.sharesHeld} shares`);
  const fromPaid = await paidOf(tenantId, from);
  if (input.amount > fromPaid + 0.005) throw new Error(`Only ${fmt(fromPaid)} of capital is recorded for ${from.name}`);
  if (!from.capitalAccountId || !to.capitalAccountId) throw new Error("Shareholder capital account is missing");

  let entryId: string | null = null;
  if (input.amount > 0.005) {
    await assertPeriodOpen(tenantId, input.effectiveDate);
    const entry = await postJournalEntry({
      tenantId,
      entryDate: input.effectiveDate,
      sourceType: "manual",
      referenceNumber: clean(input.referenceNumber) ?? undefined,
      memo: `Share transfer: ${from.name} to ${to.name}`,
      createdBy: userId,
      lines: [
        { accountId: from.capitalAccountId, debitAmount: round2(input.amount), description: `Capital transferred to ${to.name}` },
        { accountId: to.capitalAccountId, creditAmount: round2(input.amount), description: `Capital received from ${from.name}` },
      ],
    });
    entryId = entry.id;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(shareholders).set({ sharesHeld: from.sharesHeld - input.shares }).where(eq(shareholders.id, from.id));
      await tx.update(shareholders).set({ sharesHeld: to.sharesHeld + input.shares }).where(eq(shareholders.id, to.id));
    });
  } catch (e) {
    if (entryId) await reverseJournalEntry(tenantId, entryId, userId, "Share transfer could not be completed");
    throw e;
  }

  await recordChange(
    tenantId,
    userId,
    { changeType: "share_transfer", effectiveDate: input.effectiveDate, shareholderId: from.id, toShareholderId: to.id, shares: input.shares, amount: input.amount > 0 ? round2(input.amount).toFixed(2) : null, journalEntryId: entryId, reason: clean(input.reason) ?? "Share transfer", referenceNumber: clean(input.referenceNumber), supportingDocument: clean(input.supportingDocument), notes: clean(input.notes) },
    `Share transfer: ${from.name} to ${to.name}`
  );
}

/** Suggested capital to move with a transfer: proportional to the shares moved. */
export async function suggestTransferAmount(tenantId: string, fromId: string, shares: number) {
  const from = await loadHolder(tenantId, fromId);
  return proportionalPaid({ shares: from.sharesHeld, paid: await paidOf(tenantId, from) }, shares);
}

// ---------------------------------------------------------------- paid-up capital

export type PaidUpInput = Meta & {
  shareholderId: string;
  amount: number;
  /** The cash or bank account the money was received into. */
  accountId: string;
  paymentMethod: "cash" | "bank_transfer" | "cheque" | "card" | "online" | "other";
  chequeNumber?: string;
  confirmDuplicate?: boolean;
};

/**
 * Capital received from a shareholder. It is a real Money In payment ("capital
 * introduced") credited to that shareholder's capital sub-account — so it appears
 * in Payments, bank reconciliation and the audit log, and paid-up capital rises
 * because the books say so.
 */
export async function recordPaidUpIncrease(tenantId: string, userId: string, input: PaidUpInput): Promise<{ duplicateWarning: true } | { duplicateWarning: false }> {
  assertDate(input.effectiveDate, "date received");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  const cap = await loadCapital(tenantId);
  const h = await loadHolder(tenantId, input.shareholderId);
  if (h.status !== "active") throw new Error("This shareholder is inactive");
  if (!h.capitalAccountId) throw new Error("Shareholder capital account is missing");
  const paidBefore = await paidOf(tenantId, h);
  if (cap.faceValue > 0 && paidBefore + input.amount > h.sharesHeld * cap.faceValue + 0.005) {
    throw new Error(`${h.name} can pay in at most ${fmt(Math.max(h.sharesHeld * cap.faceValue - paidBefore, 0))} more (shares × face value, less what's already paid).`);
  }
  const before = (await getOwnershipSnapshot(tenantId)).capital.paidUpCapital;

  const paymentNumber = await buildNextPaymentNumber(tenantId, "money_in");
  const result: CreatePaymentResult = await createPayment(tenantId, userId, paymentNumber, {
    direction: "money_in",
    paymentType: "capital_introduced",
    paymentDate: input.effectiveDate,
    partyType: "other",
    partyOtherName: h.name,
    accountId: input.accountId,
    categoryAccountId: h.capitalAccountId,
    paymentMethod: input.paymentMethod,
    chequeNumber: input.chequeNumber || null,
    referenceNumber: clean(input.referenceNumber),
    amount: input.amount,
    description: `Capital paid in by ${h.name}`,
    confirmDuplicate: input.confirmDuplicate,
  });
  if ("duplicateWarning" in result) return { duplicateWarning: true };

  try {
    await recordChange(
      tenantId,
      userId,
      { changeType: "paid_up_capital_increase", effectiveDate: input.effectiveDate, shareholderId: h.id, amount: round2(input.amount).toFixed(2), previousValue: before.toFixed(2), newValue: round2(before + input.amount).toFixed(2), paymentId: result.paymentId, reason: clean(input.reason) ?? "Paid-up capital increased", referenceNumber: clean(input.referenceNumber), supportingDocument: clean(input.supportingDocument), notes: clean(input.notes) },
      `Paid-up capital received from ${h.name}`
    );
  } catch (e) {
    await voidPayment(tenantId, result.paymentId, userId, "Capital change could not be recorded");
    throw e;
  }
  return { duplicateWarning: false };
}

/**
 * Capital already in the books but never assigned to a shareholder (it sits on the
 * capital group itself) is assigned to one by a reclassification entry.
 */
export async function assignExistingCapital(tenantId: string, userId: string, input: Meta & { shareholderId: string; amount: number }) {
  assertDate(input.effectiveDate, "date");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  const group = await ensureShareCapitalGroup(tenantId);
  const h = await loadHolder(tenantId, input.shareholderId);
  if (!h.capitalAccountId) throw new Error("Shareholder capital account is missing");
  const unassigned = (await creditBalances(tenantId, [group.id])).get(group.id) ?? 0;
  if (input.amount > unassigned + 0.005) throw new Error(`Only ${fmt(Math.max(unassigned, 0))} of capital is unassigned`);

  const entry = await postJournalEntry({
    tenantId,
    entryDate: input.effectiveDate,
    sourceType: "manual",
    referenceNumber: clean(input.referenceNumber) ?? undefined,
    memo: `Capital assigned to shareholder ${h.name}`,
    createdBy: userId,
    lines: [
      { accountId: group.id, debitAmount: round2(input.amount), description: `Assigned to ${h.name}` },
      { accountId: h.capitalAccountId, creditAmount: round2(input.amount), description: "Assigned from unallocated capital" },
    ],
  });
  await recordChange(tenantId, userId, { changeType: "capital_assignment", effectiveDate: input.effectiveDate, shareholderId: h.id, amount: round2(input.amount).toFixed(2), journalEntryId: entry.id, reason: clean(input.reason) ?? "Existing capital assigned to shareholder", referenceNumber: clean(input.referenceNumber), supportingDocument: clean(input.supportingDocument), notes: clean(input.notes) });
}

// ---------------------------------------------------------------- Share Lagat

export async function recordShareLagatUpdate(tenantId: string, userId: string, input: { lastUpdatedDate: string; referenceNumber: string; supportingDocument: string; notes: string; reason: string }) {
  assertDate(input.lastUpdatedDate, "update date");
  const [latest] = await db.select().from(shareLagatEntries).where(eq(shareLagatEntries.tenantId, tenantId)).orderBy(desc(shareLagatEntries.createdAt)).limit(1);
  const [row] = await db
    .insert(shareLagatEntries)
    .values({
      tenantId,
      status: "updated",
      lastUpdatedDate: input.lastUpdatedDate,
      lastChangeDate: latest?.lastChangeDate ?? null,
      reason: clean(input.reason) ?? "Share Lagat updated",
      referenceNumber: clean(input.referenceNumber),
      supportingDocument: clean(input.supportingDocument),
      notes: clean(input.notes),
      isAutomatic: false,
      createdBy: userId,
    })
    .returning();
  await logAuditEvent({ tenantId, userId, action: "share_lagat_updated", entityType: "share_lagat", entityId: row.id, before: { status: latest?.status ?? null }, after: { status: "updated", date: input.lastUpdatedDate, reference: clean(input.referenceNumber) } });
}
