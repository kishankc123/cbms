import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, payments, purchaseBills, supplierReconLines, supplierReconMatchItems, supplierReconciliations, vendors } from "@/db/schema";
import { buildStatement, getPartyLines } from "@/lib/ledger/party-ledger";
import { addDays, coverage, type Period } from "./reconcile-status-rules";
import { getReconciliation, ourSide } from "./reconcile";

// What the supplier profile, the suppliers list and the edit warnings say about reconciliation. Read-only: everything here comes from what the reconciliations
// already record.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function signedOff(tenantId: string, vendorId?: string) {
  return db
    .select({ vendorId: supplierReconciliations.vendorId, from: supplierReconciliations.fromDate, to: supplierReconciliations.toDate, signedOffAt: supplierReconciliations.signedOffAt })
    .from(supplierReconciliations)
    .where(and(eq(supplierReconciliations.tenantId, tenantId), eq(supplierReconciliations.status, "reconciled"), ...(vendorId ? [eq(supplierReconciliations.vendorId, vendorId)] : [])));
}

/** The last day each supplier has been reconciled up to (a signed-off period's end), for the suppliers list. Suppliers never reconciled are left out. */
export async function reconciledThrough(tenantId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ vendorId: supplierReconciliations.vendorId, through: sql<string>`max(${supplierReconciliations.toDate})` })
    .from(supplierReconciliations)
    .where(and(eq(supplierReconciliations.tenantId, tenantId), eq(supplierReconciliations.status, "reconciled")))
    .groupBy(supplierReconciliations.vendorId);
  return Object.fromEntries(rows.map((r) => [r.vendorId, r.through]));
}

/** The signed-off periods of one supplier, for ticking the lines of their transaction history that were reconciled. */
export async function reconciledPeriods(tenantId: string, vendorId: string): Promise<Period[]> {
  return (await signedOff(tenantId, vendorId)).map((r) => ({ from: r.from, to: r.to }));
}

export type SupplierReconStatus = {
  through: string | null;
  signedOffAt: string | null;
  gaps: Period[];
  /** What has happened in the books since the reconciled date: entries, and how much the balance has moved. */
  since: { entries: number; movement: number } | null;
  inProgress: { id: string; from: string; to: string } | null;
  rows: { id: string; from: string; to: string; fileName: string; status: string; ourClosing: number; theirClosing: number; difference: number; signedOffAt: string | null; lines: number; matched: number }[];
};

export async function supplierReconStatus(tenantId: string, vendorId: string, today: string): Promise<SupplierReconStatus> {
  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  if (!vendor) throw new Error("Supplier not found");
  const recs = await db.select().from(supplierReconciliations).where(and(eq(supplierReconciliations.tenantId, tenantId), eq(supplierReconciliations.vendorId, vendorId))).orderBy(desc(supplierReconciliations.toDate), desc(supplierReconciliations.createdAt));

  const signed = recs.filter((r) => r.status === "reconciled");
  const cover = coverage(signed.map((r) => ({ from: r.fromDate, to: r.toDate })));
  const last = signed.find((r) => r.toDate === cover.through);
  const draft = recs.find((r) => r.status === "draft") ?? null;

  const lines = vendor.payableAccountId ? (await getPartyLines(tenantId, [vendor.payableAccountId])).get(vendor.payableAccountId) ?? [] : [];
  let since: SupplierReconStatus["since"] = null;
  if (cover.through) {
    const after = await ourSide(tenantId, vendorId, addDays(cover.through, 1), today > cover.through ? today : addDays(cover.through, 1));
    since = { entries: after.lines.length, movement: round2(after.closing - after.opening) };
  }

  const ids = recs.map((r) => r.id);
  const lineCounts = ids.length ? await db.select({ id: supplierReconLines.reconId, n: sql<number>`count(*)::int` }).from(supplierReconLines).where(and(eq(supplierReconLines.tenantId, tenantId), inArray(supplierReconLines.reconId, ids))).groupBy(supplierReconLines.reconId) : [];
  const matchCounts = ids.length ? await db.select({ id: supplierReconMatchItems.reconId, n: sql<number>`count(distinct ${supplierReconMatchItems.theirLineId})::int` }).from(supplierReconMatchItems).where(and(eq(supplierReconMatchItems.tenantId, tenantId), inArray(supplierReconMatchItems.reconId, ids))).groupBy(supplierReconMatchItems.reconId) : [];

  return {
    through: cover.through,
    signedOffAt: last?.signedOffAt ? last.signedOffAt.toISOString().slice(0, 10) : null,
    gaps: cover.gaps,
    since,
    inProgress: draft ? { id: draft.id, from: draft.fromDate, to: draft.toDate } : null,
    rows: recs.map((r) => {
      // A signed-off reconciliation keeps the figure it was signed on; one in progress is read from the books as they are now.
      const ourClosing = r.ourClosing !== null ? Number(r.ourClosing) : buildStatement(lines, "credit", { from: r.fromDate, to: r.toDate }).closingBalance;
      return {
        id: r.id,
        from: r.fromDate,
        to: r.toDate,
        fileName: r.fileName,
        status: r.status,
        ourClosing,
        theirClosing: Number(r.theirClosing),
        difference: round2(ourClosing - Number(r.theirClosing)),
        signedOffAt: r.signedOffAt ? r.signedOffAt.toISOString().slice(0, 10) : null,
        lines: lineCounts.find((l) => l.id === r.id)?.n ?? 0,
        matched: matchCounts.find((m) => m.id === r.id)?.n ?? 0,
      };
    }),
  };
}

export type StatementRow = { date: string; reference: string; description: string; effect: number; state: "matched" | "suggested" | "leftover"; against: string };

/** The supplier's statement as it was uploaded, each row with what it was set against in the books (or why it was left over). */
export async function statementRows(tenantId: string, reconId: string): Promise<{ vendorName: string; from: string; to: string; fileName: string; rows: StatementRow[] }> {
  const d = await getReconciliation(tenantId, reconId);
  const ourById = new Map(d.ours.lines.map((l) => [l.id, l]));
  const groupOf = new Map<string, (typeof d.groups)[number]>();
  for (const g of d.groups) if (!g.stale) for (const id of g.theirIds) groupOf.set(id, g);
  const REASON: Record<string, string> = { timing: "Timing", dispute: "Disputed", our_error: "Our mistake", their_error: "Their mistake", other: "Other" };
  const flagOf = new Map(d.theirsOnly.map((l) => [l.id, l.flag]));
  return {
    vendorName: d.vendor.name,
    from: d.recon.fromDate,
    to: d.recon.toDate,
    fileName: d.recon.fileName,
    rows: d.theirs.map((l) => {
      const g = groupOf.get(l.id);
      if (g) {
        const refs = g.ourIds.map((id) => ourById.get(id)?.reference).filter(Boolean).join(", ");
        return { date: l.date, reference: l.reference, description: l.description, effect: l.effect, state: g.status === "confirmed" ? "matched" : "suggested", against: refs || "In your books" };
      }
      const flag = flagOf.get(l.id);
      return { date: l.date, reference: l.reference, description: l.description, effect: l.effect, state: "leftover", against: flag ? REASON[flag.reason] ?? flag.reason : "Not in your books" };
    }),
  };
}

export type ReconciledWarning = { vendorName: string; from: string; to: string; signedOffAt: string | null };

/** When a bill, expense or payment belongs to a supplier and is dated inside a period that was signed off with them, what to tell the person before they change it. */
export async function reconciledWarning(tenantId: string, kind: "bill" | "expense" | "payment", id: string): Promise<ReconciledWarning | null> {
  let vendorId: string | null = null;
  let date = "";
  if (kind === "bill") {
    const [r] = await db.select({ v: purchaseBills.vendorId, d: purchaseBills.billDate }).from(purchaseBills).where(and(eq(purchaseBills.id, id), eq(purchaseBills.tenantId, tenantId))).limit(1);
    vendorId = r?.v ?? null;
    date = r?.d ?? "";
  } else if (kind === "expense") {
    const [r] = await db.select({ v: expenses.vendorId, d: expenses.expenseDate }).from(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId))).limit(1);
    vendorId = r?.v ?? null;
    date = r?.d ?? "";
  } else {
    const [r] = await db.select({ v: payments.vendorId, d: payments.paymentDate }).from(payments).where(and(eq(payments.id, id), eq(payments.tenantId, tenantId))).limit(1);
    vendorId = r?.v ?? null;
    date = r?.d ?? "";
  }
  if (!vendorId || !date) return null;
  const hit = (await signedOff(tenantId, vendorId)).filter((r) => date >= r.from && date <= r.to).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
  if (!hit) return null;
  const [vendor] = await db.select({ name: vendors.name }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  return { vendorName: vendor?.name ?? "the supplier", from: hit.from, to: hit.to, signedOffAt: hit.signedOffAt ? hit.signedOffAt.toISOString().slice(0, 10) : null };
}
