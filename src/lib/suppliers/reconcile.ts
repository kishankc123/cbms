import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, payments, supplierReconFlags, supplierReconLines, supplierReconMatchItems, supplierReconMatches, supplierReconciliations, vendors } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { buildStatement, describeLine, getPartyLines, type PartyLine } from "@/lib/ledger/party-ledger";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { normalizeStatementRows, type ColumnMapping } from "@/lib/banking/normalize-rows";
import { detectOrientation, effectOf, matchLedgers, proof, statementBalances, type Line, type MatchGroup, type Orientation } from "./reconcile-rules";
import { guessMapping, mappingProblem } from "./statement-columns";

// Reconciling a supplier's statement against our supplier account (see reconcile-rules.ts). Plain server helpers, deliberately not server actions: the
// actions in suppliers/reconcile check the permission first. Nothing here posts to the books.

export class ReconError extends Error {}
const fail = (message: string): never => {
  throw new ReconError(message);
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_ROWS = 3000;

export const REASONS = { timing: "Timing: the other side will catch up", dispute: "Disputed", our_error: "Our mistake, to correct", their_error: "Their mistake, to raise", other: "Other" } as const;
export type Reason = keyof typeof REASONS;

// ------------------------------------------------------------------------------------------------------------ our side

/**
 * Our books for one supplier over a period: the balance at the start and the end, and one line per journal entry in between. A bill that was voided or
 * edited and its reversal, both inside the period, cancel out and are left off; a reversal of something from before the period stays, since it is a real change.
 */
export async function ourSide(tenantId: string, vendorId: string, from: string, to: string) {
  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  if (!vendor) return fail("That supplier was not found.");
  const all: PartyLine[] = vendor!.payableAccountId ? (await getPartyLines(tenantId, [vendor!.payableAccountId])).get(vendor!.payableAccountId) ?? [] : [];
  const statement = buildStatement(all, "credit", { from, to });
  const inRange = all.filter((l) => l.sourceType !== "opening_balance" && l.date >= from && l.date <= to);
  const idsInRange = new Set(inRange.map((l) => l.entryId).filter(Boolean));
  const reversedInRange = new Set(inRange.map((l) => l.reversalOfId).filter(Boolean));
  const kept = inRange.filter((l) => !(l.reversalOfId && idsInRange.has(l.reversalOfId)) && !(l.entryId && reversedInRange.has(l.entryId)));

  // The supplier knows an expense by their own invoice number and a payment by the cheque or receipt number, not by ours: add those to the line so they can be matched.
  const expenseIds = [...new Set(kept.filter((l) => l.sourceType === "expense" && l.sourceId).map((l) => l.sourceId as string))];
  const invoiceOf = new Map<string, string>();
  if (expenseIds.length > 0) for (const e of await db.select({ id: expenses.id, n: expenses.invoiceNumber }).from(expenses).where(and(eq(expenses.tenantId, tenantId), inArray(expenses.id, expenseIds)))) if (e.n) invoiceOf.set(e.id, e.n);
  const entryIds = [...new Set(kept.filter((l) => l.sourceType === "payment" && l.entryId).map((l) => l.entryId as string))];
  const paymentRefs = new Map<string, string>();
  if (entryIds.length > 0) for (const p of await db.select({ entry: payments.journalEntryId, ref: payments.referenceNumber, cheque: payments.chequeNumber }).from(payments).where(and(eq(payments.tenantId, tenantId), inArray(payments.journalEntryId, entryIds)))) if (p.entry) paymentRefs.set(p.entry, [p.ref, p.cheque].filter(Boolean).join(" "));

  const byEntry = new Map<string, Line>();
  for (const l of kept) {
    const id = l.entryId as string;
    const e = l.credit - l.debit;
    const have = byEntry.get(id);
    if (have) have.effect = round2(have.effect + e);
    else byEntry.set(id, { id, date: l.date, reference: [invoiceOf.get(l.sourceId ?? ""), l.reference, paymentRefs.get(id)].filter(Boolean).join(" "), description: describeLine(l), effect: round2(e) });
  }
  const lines = [...byEntry.values()].filter((l) => l.effect !== 0);
  return { vendor: vendor!, opening: statement.openingBalance, closing: statement.closingBalance, lines };
}

// ----------------------------------------------------------------------------------------------------------- their side

export type Preview = {
  fileName: string;
  headers: string[];
  mapping: ColumnMapping;
  problem: string | null;
  orientation: Orientation;
  rowsRead: number;
  rowsSkipped: number;
  inPeriod: number;
  theirOpening: number;
  theirClosing: number;
  sample: { date: string; reference: string; description: string; debit: number; credit: number; balance: number | null }[];
  ourOpening: number;
  ourClosing: number;
};

function readRows(base64: string, fileName: string, mapping: ColumnMapping | null) {
  let parsed;
  try {
    parsed = parseStatementFile(base64, fileName);
  } catch {
    return fail("That file couldn't be read. Upload an Excel (.xlsx) or CSV file.");
  }
  if (parsed.headers.length === 0) fail("The file looks empty.");
  const map = mapping ?? guessMapping(parsed.headers);
  const problem = mappingProblem(map);
  const { valid, skipped } = problem ? { valid: [], skipped: 0 } : normalizeStatementRows(parsed.headers, parsed.rows, map);
  if (valid.length > MAX_ROWS) fail(`The file has ${valid.length} rows. Upload one period at a time (up to ${MAX_ROWS} rows).`);
  return { parsed, map, problem, valid, skipped };
}

/** Reads the file and shows what it found, before anything is saved. */
export async function previewStatement(tenantId: string, input: { vendorId: string; from: string; to: string; fileName: string; base64: string; mapping?: ColumnMapping | null; orientation?: Orientation | null }): Promise<Preview> {
  const { parsed, map, problem, valid, skipped } = readRows(input.base64, input.fileName, input.mapping ?? null);
  const orientation = input.orientation ?? detectOrientation(valid.map((r) => ({ amount: r.amount, balance: r.runningBalance })));
  const period = valid.filter((r) => r.transactionDate >= input.from && r.transactionDate <= input.to);
  const balances = statementBalances(period.map((r) => ({ amount: r.amount, balance: r.runningBalance })), orientation);
  const ours = await ourSide(tenantId, input.vendorId, input.from, input.to);
  return {
    fileName: input.fileName,
    headers: parsed.headers,
    mapping: map,
    problem,
    orientation,
    rowsRead: valid.length,
    rowsSkipped: skipped,
    inPeriod: period.length,
    theirOpening: balances.opening,
    theirClosing: balances.closing,
    sample: period.slice(0, 6).map((r) => ({ date: r.transactionDate, reference: r.reference, description: r.description, debit: r.amount < 0 ? -r.amount : 0, credit: r.amount > 0 ? r.amount : 0, balance: r.runningBalance })),
    ourOpening: ours.opening,
    ourClosing: ours.closing,
  };
}

// ---------------------------------------------------------------------------------------------------------------- create

export type CreateInput = {
  vendorId: string;
  from: string;
  to: string;
  fileName: string;
  base64: string;
  mapping: ColumnMapping;
  orientation: Orientation;
  theirOpening?: number | null;
  theirClosing?: number | null;
  dateToleranceDays?: number;
  amountTolerance?: number;
};

async function saveGroups(tenantId: string, reconId: string, groups: MatchGroup[]) {
  for (const g of groups) {
    const [m] = await db.insert(supplierReconMatches).values({ tenantId, reconId, kind: g.kind, status: g.auto ? "confirmed" : "suggested" }).returning({ id: supplierReconMatches.id });
    await db.insert(supplierReconMatchItems).values([
      ...g.theirIds.map((theirLineId) => ({ tenantId, reconId, matchId: m.id, theirLineId })),
      ...g.ourIds.map((entryId) => ({ tenantId, reconId, matchId: m.id, entryId })),
    ]);
  }
}

export async function createReconciliation(tenantId: string, userId: string, input: CreateInput) {
  if (!input.from || !input.to || input.from > input.to) fail("Choose the period: the start can't be after the end.");
  const problem = mappingProblem(input.mapping);
  if (problem) fail(problem);
  const { valid } = readRows(input.base64, input.fileName, input.mapping);
  const period = valid.filter((r) => r.transactionDate >= input.from && r.transactionDate <= input.to);
  if (period.length === 0) fail("None of the rows in the file fall in that period. Check the dates and the period.");
  const dateDays = Math.min(Math.max(Math.round(input.dateToleranceDays ?? 7), 0), 60);
  const amountTol = Math.min(Math.max(input.amountTolerance ?? 1, 0), 1000);
  const balances = statementBalances(period.map((r) => ({ amount: r.amount, balance: r.runningBalance })), input.orientation);

  const [recon] = await db
    .insert(supplierReconciliations)
    .values({
      tenantId,
      vendorId: input.vendorId,
      fromDate: input.from,
      toDate: input.to,
      fileName: input.fileName,
      orientation: input.orientation,
      theirOpening: round2(input.theirOpening ?? balances.opening).toFixed(2),
      theirClosing: round2(input.theirClosing ?? balances.closing).toFixed(2),
      dateToleranceDays: dateDays,
      amountTolerance: amountTol.toFixed(2),
      createdBy: userId,
    })
    .returning();
  // The supplier must be this organization's: ourSide checks it, and a failure here takes the new row back.
  try {
    await ourSide(tenantId, input.vendorId, input.from, input.to);
  } catch (e) {
    await db.delete(supplierReconciliations).where(and(eq(supplierReconciliations.id, recon.id), eq(supplierReconciliations.tenantId, tenantId)));
    throw e;
  }
  const lines = await db
    .insert(supplierReconLines)
    .values(period.map((r, i) => ({ tenantId, reconId: recon.id, rowNo: i + 1, txDate: r.transactionDate, reference: r.reference, description: r.description, effect: effectOf(r.amount, input.orientation).toFixed(2) })))
    .returning();
  await rematchInternal(tenantId, recon.id, lines.map((l) => ({ id: l.id, date: l.txDate, reference: l.reference, description: l.description, effect: Number(l.effect) })));
  await logAuditEvent({ tenantId, userId, action: "supplier_reconciliation_created", entityType: "supplier_reconciliation", entityId: recon.id, after: { vendorId: input.vendorId, from: input.from, to: input.to, rows: lines.length } });
  return recon;
}

// ---------------------------------------------------------------------------------------------------------------- matching

async function loadRecon(tenantId: string, id: string) {
  const [r] = await db.select().from(supplierReconciliations).where(and(eq(supplierReconciliations.id, id), eq(supplierReconciliations.tenantId, tenantId))).limit(1);
  if (!r) return fail("That reconciliation was not found.");
  return r!;
}

/** Matches whatever is not already in a confirmed match, replacing the earlier suggestions. Confirmed matches stay. */
async function rematchInternal(tenantId: string, reconId: string, theirLines?: Line[]) {
  const recon = await loadRecon(tenantId, reconId);
  const ours = await ourSide(tenantId, recon.vendorId, recon.fromDate, recon.toDate);
  const theirs =
    theirLines ??
    (await db.select().from(supplierReconLines).where(and(eq(supplierReconLines.reconId, reconId), eq(supplierReconLines.tenantId, tenantId))).orderBy(asc(supplierReconLines.rowNo))).map((l) => ({ id: l.id, date: l.txDate, reference: l.reference, description: l.description, effect: Number(l.effect) }));

  const stale = await db.select({ id: supplierReconMatches.id }).from(supplierReconMatches).where(and(eq(supplierReconMatches.reconId, reconId), eq(supplierReconMatches.tenantId, tenantId), eq(supplierReconMatches.status, "suggested")));
  if (stale.length > 0) await db.delete(supplierReconMatches).where(and(eq(supplierReconMatches.tenantId, tenantId), inArray(supplierReconMatches.id, stale.map((s) => s.id))));
  const items = await db.select().from(supplierReconMatchItems).where(and(eq(supplierReconMatchItems.reconId, reconId), eq(supplierReconMatchItems.tenantId, tenantId)));
  const usedT = new Set(items.map((i) => i.theirLineId).filter(Boolean) as string[]);
  const usedO = new Set(items.map((i) => i.entryId).filter(Boolean) as string[]);

  const result = matchLedgers(
    theirs.filter((l) => !usedT.has(l.id)),
    ours.lines.filter((l) => !usedO.has(l.id)),
    { dateDays: recon.dateToleranceDays, amount: Number(recon.amountTolerance) }
  );
  await saveGroups(tenantId, reconId, result.groups);
}

export async function rematch(tenantId: string, userId: string, reconId: string) {
  const recon = await loadRecon(tenantId, reconId);
  if (recon.status === "reconciled") fail("This reconciliation is signed off. Reopen it to change it.");
  await rematchInternal(tenantId, reconId);
  await logAuditEvent({ tenantId, userId, action: "supplier_reconciliation_rematched", entityType: "supplier_reconciliation", entityId: reconId });
}

// ------------------------------------------------------------------------------------------------------------------ detail

export async function getReconciliation(tenantId: string, id: string) {
  const recon = await loadRecon(tenantId, id);
  const ours = await ourSide(tenantId, recon.vendorId, recon.fromDate, recon.toDate);
  const theirRows = await db.select().from(supplierReconLines).where(and(eq(supplierReconLines.reconId, id), eq(supplierReconLines.tenantId, tenantId))).orderBy(asc(supplierReconLines.rowNo));
  const theirs: Line[] = theirRows.map((l) => ({ id: l.id, date: l.txDate, reference: l.reference, description: l.description, effect: Number(l.effect) }));
  const matches = await db.select().from(supplierReconMatches).where(and(eq(supplierReconMatches.reconId, id), eq(supplierReconMatches.tenantId, tenantId)));
  const items = await db.select().from(supplierReconMatchItems).where(and(eq(supplierReconMatchItems.reconId, id), eq(supplierReconMatchItems.tenantId, tenantId)));
  const flags = await db.select().from(supplierReconFlags).where(and(eq(supplierReconFlags.reconId, id), eq(supplierReconFlags.tenantId, tenantId)));

  const ourIds = new Set(ours.lines.map((l) => l.id));
  const groups = matches.map((m) => {
    const mine = items.filter((i) => i.matchId === m.id);
    const ourItems = mine.filter((i) => i.entryId).map((i) => i.entryId as string);
    return {
      id: m.id,
      kind: m.kind,
      status: m.status as "confirmed" | "suggested",
      theirIds: mine.filter((i) => i.theirLineId).map((i) => i.theirLineId as string),
      ourIds: ourItems.filter((e) => ourIds.has(e)),
      // A book entry that is no longer there (voided or edited since) leaves the match needing another look.
      stale: ourItems.some((e) => !ourIds.has(e)),
    };
  });
  const live = groups.filter((g) => !g.stale);
  const matchedT = new Set(live.flatMap((g) => g.theirIds));
  const matchedO = new Set(live.flatMap((g) => g.ourIds));
  const theirsOnly = theirs.filter((l) => !matchedT.has(l.id));
  const oursOnly = ours.lines.filter((l) => !matchedO.has(l.id));
  const p = proof({
    ourOpening: ours.opening,
    ourClosing: ours.closing,
    theirOpening: Number(recon.theirOpening),
    theirClosing: Number(recon.theirClosing),
    theirs,
    ours: ours.lines,
    groups: live.map((g) => ({ kind: g.kind as MatchGroup["kind"], auto: g.status === "confirmed", theirIds: g.theirIds, ourIds: g.ourIds })),
  });
  const flagOf = (key: { theirLineId?: string; entryId?: string }) => flags.find((f) => (key.theirLineId ? f.theirLineId === key.theirLineId : f.entryId === key.entryId));
  const unresolved = theirsOnly.filter((l) => !flagOf({ theirLineId: l.id })).length + oursOnly.filter((l) => !flagOf({ entryId: l.id })).length;
  return {
    recon,
    vendor: { id: ours.vendor.id, name: ours.vendor.name },
    ours,
    theirs,
    groups,
    theirsOnly: theirsOnly.map((l) => ({ ...l, flag: flagOf({ theirLineId: l.id }) ?? null })),
    oursOnly: oursOnly.map((l) => ({ ...l, flag: flagOf({ entryId: l.id }) ?? null })),
    proof: p,
    unresolved,
    suggested: groups.filter((g) => g.status === "suggested" && !g.stale).length,
    stale: groups.filter((g) => g.stale).length,
  };
}

export async function listReconciliations(tenantId: string) {
  const rows = await db
    .select({ r: supplierReconciliations, vendorName: vendors.name })
    .from(supplierReconciliations)
    .innerJoin(vendors, eq(vendors.id, supplierReconciliations.vendorId))
    .where(eq(supplierReconciliations.tenantId, tenantId))
    .orderBy(desc(supplierReconciliations.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((x) => x.r.id);
  const matched = await db
    .select({ reconId: supplierReconMatchItems.reconId, n: sql<number>`count(distinct ${supplierReconMatchItems.theirLineId})::int` })
    .from(supplierReconMatchItems)
    .where(and(eq(supplierReconMatchItems.tenantId, tenantId), inArray(supplierReconMatchItems.reconId, ids)))
    .groupBy(supplierReconMatchItems.reconId);
  const lines = await db
    .select({ reconId: supplierReconLines.reconId, n: sql<number>`count(*)::int` })
    .from(supplierReconLines)
    .where(and(eq(supplierReconLines.tenantId, tenantId), inArray(supplierReconLines.reconId, ids)))
    .groupBy(supplierReconLines.reconId);
  return rows.map((x) => ({ ...x.r, vendorName: x.vendorName, lines: lines.find((l) => l.reconId === x.r.id)?.n ?? 0, matched: matched.find((m) => m.reconId === x.r.id)?.n ?? 0 }));
}

// -------------------------------------------------------------------------------------------------------- the person's say

export async function confirmMatch(tenantId: string, userId: string, matchId: string) {
  const [m] = await db.select().from(supplierReconMatches).where(and(eq(supplierReconMatches.id, matchId), eq(supplierReconMatches.tenantId, tenantId))).limit(1);
  if (!m) return fail("That match was not found.");
  const recon = await loadRecon(tenantId, m!.reconId);
  if (recon.status === "reconciled") fail("This reconciliation is signed off. Reopen it to change it.");
  await db.update(supplierReconMatches).set({ status: "confirmed" }).where(and(eq(supplierReconMatches.id, matchId), eq(supplierReconMatches.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "supplier_match_confirmed", entityType: "supplier_reconciliation", entityId: recon.id });
}

/** Takes a match apart: its lines go back to the leftovers (and a refresh will not suggest the same pairing again for lines in a confirmed match, only for these). */
export async function unmatch(tenantId: string, userId: string, matchId: string) {
  const [m] = await db.select().from(supplierReconMatches).where(and(eq(supplierReconMatches.id, matchId), eq(supplierReconMatches.tenantId, tenantId))).limit(1);
  if (!m) return fail("That match was not found.");
  const recon = await loadRecon(tenantId, m!.reconId);
  if (recon.status === "reconciled") fail("This reconciliation is signed off. Reopen it to change it.");
  await db.delete(supplierReconMatches).where(and(eq(supplierReconMatches.id, matchId), eq(supplierReconMatches.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "supplier_match_removed", entityType: "supplier_reconciliation", entityId: recon.id });
}

/** A match the person makes by hand: lines on their statement and entries in our books that belong together. Confirmed straight away. */
export async function manualMatch(tenantId: string, userId: string, reconId: string, theirLineIds: string[], entryIds: string[]) {
  const recon = await loadRecon(tenantId, reconId);
  if (recon.status === "reconciled") fail("This reconciliation is signed off. Reopen it to change it.");
  if (theirLineIds.length === 0 || entryIds.length === 0) fail("Choose at least one line from their statement and one from your books.");
  const real = await db.select({ id: supplierReconLines.id }).from(supplierReconLines).where(and(eq(supplierReconLines.reconId, reconId), eq(supplierReconLines.tenantId, tenantId), inArray(supplierReconLines.id, theirLineIds)));
  if (real.length !== new Set(theirLineIds).size) fail("One of those lines isn't on this statement.");
  const ours = await ourSide(tenantId, recon.vendorId, recon.fromDate, recon.toDate);
  const mine = new Set(ours.lines.map((l) => l.id));
  if (entryIds.some((e) => !mine.has(e))) fail("One of those entries isn't in your books for this period any more. Refresh and try again.");
  const taken = await db
    .select({ id: supplierReconMatchItems.id })
    .from(supplierReconMatchItems)
    .where(and(eq(supplierReconMatchItems.reconId, reconId), eq(supplierReconMatchItems.tenantId, tenantId), sql`(${supplierReconMatchItems.theirLineId} in (${sql.join(theirLineIds.map((i) => sql`${i}::uuid`), sql`, `)}) or ${supplierReconMatchItems.entryId} in (${sql.join(entryIds.map((i) => sql`${i}::uuid`), sql`, `)}))`))
    .limit(1);
  if (taken.length > 0) fail("One of those lines is already in a match. Undo that match first.");
  const [m] = await db.insert(supplierReconMatches).values({ tenantId, reconId, kind: "manual", status: "confirmed" }).returning({ id: supplierReconMatches.id });
  await db.insert(supplierReconMatchItems).values([
    ...theirLineIds.map((theirLineId) => ({ tenantId, reconId, matchId: m.id, theirLineId })),
    ...entryIds.map((entryId) => ({ tenantId, reconId, matchId: m.id, entryId })),
  ]);
  await logAuditEvent({ tenantId, userId, action: "supplier_match_manual", entityType: "supplier_reconciliation", entityId: reconId, after: { theirLines: theirLineIds.length, entries: entryIds.length } });
}

/** Says why a leftover is there. A null reason clears it. */
export async function setFlag(tenantId: string, userId: string, reconId: string, key: { theirLineId?: string; entryId?: string }, reason: Reason | null, note: string) {
  const recon = await loadRecon(tenantId, reconId);
  if (recon.status === "reconciled") fail("This reconciliation is signed off. Reopen it to change it.");
  if (!key.theirLineId === !key.entryId) fail("Choose one line.");
  if (reason && !(reason in REASONS)) fail("Choose a reason from the list.");
  const where = and(eq(supplierReconFlags.reconId, reconId), eq(supplierReconFlags.tenantId, tenantId), key.theirLineId ? eq(supplierReconFlags.theirLineId, key.theirLineId) : eq(supplierReconFlags.entryId, key.entryId as string));
  await db.delete(supplierReconFlags).where(where);
  if (reason) await db.insert(supplierReconFlags).values({ tenantId, reconId, theirLineId: key.theirLineId ?? null, entryId: key.entryId ?? null, reason, note: note.trim() || null });
  await logAuditEvent({ tenantId, userId, action: "supplier_recon_flag", entityType: "supplier_reconciliation", entityId: reconId, after: { reason } });
}

export async function signOff(tenantId: string, userId: string, reconId: string, notes: string) {
  const d = await getReconciliation(tenantId, reconId);
  if (d.recon.status === "reconciled") fail("This reconciliation is already signed off.");
  if (d.suggested > 0) fail(`Confirm or undo the ${d.suggested} suggested match${d.suggested === 1 ? "" : "es"} first.`);
  if (d.stale > 0) fail("Something in your books changed since a match was made. Refresh from your books first.");
  if (d.unresolved > 0) fail(`${d.unresolved} leftover${d.unresolved === 1 ? " has" : "s have"} no reason yet. Choose one for each, or fix it in your books and refresh.`);
  await db.update(supplierReconciliations).set({ status: "reconciled", ourClosing: d.ours.closing.toFixed(2), signedOffBy: userId, signedOffAt: new Date(), notes: notes.trim() || d.recon.notes }).where(and(eq(supplierReconciliations.id, reconId), eq(supplierReconciliations.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "supplier_reconciliation_signed_off", entityType: "supplier_reconciliation", entityId: reconId });
}

export async function reopen(tenantId: string, userId: string, reconId: string) {
  const recon = await loadRecon(tenantId, reconId);
  if (recon.status !== "reconciled") fail("This reconciliation isn't signed off.");
  await db.update(supplierReconciliations).set({ status: "draft", ourClosing: null, signedOffBy: null, signedOffAt: null }).where(and(eq(supplierReconciliations.id, reconId), eq(supplierReconciliations.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "supplier_reconciliation_reopened", entityType: "supplier_reconciliation", entityId: reconId });
}

export async function deleteReconciliation(tenantId: string, userId: string, reconId: string) {
  const recon = await loadRecon(tenantId, reconId);
  await db.delete(supplierReconciliations).where(and(eq(supplierReconciliations.id, reconId), eq(supplierReconciliations.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "supplier_reconciliation_deleted", entityType: "supplier_reconciliation", entityId: reconId, before: { from: recon.fromDate, to: recon.toDate } });
}
