import { and, eq, gte, lte, notInArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalLines, journalEntries, bankReconciliationMatchJournalLines } from "@/db/schema";

export type MatchCandidate = {
  journalLineId: string;
  journalEntryId: string;
  entryDate: string;
  memo: string | null;
  referenceNumber: string | null;
  description: string | null;
  signedAmount: number;
  score: number;
  tier: "exact" | "suggested";
};

const DATE_WINDOW_DAYS = 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(a: string, b: string) {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db_ = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(da - db_) / 86400000;
}

function textOverlapScore(a: string, b: string) {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  const tokensA = new Set(na.split(/\s+/).filter((t) => t.length > 2));
  const tokensB = new Set(nb.split(/\s+/).filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

// Deterministic weighted-scoring match — not ML. Amount must match exactly
// (within rounding) to be considered a candidate at all; date proximity,
// reference-number agreement, and description similarity add up the rest of
// the confidence score. Every candidate still requires an explicit user
// confirmation to become a real match (see actions.ts) — nothing here
// auto-reconciles.
export async function findMatchCandidates(
  tenantId: string,
  chartAccountId: string,
  statementLine: { transactionDate: string; amount: number; description: string; reference: string }
): Promise<MatchCandidate[]> {
  const from = new Date(statementLine.transactionDate + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - DATE_WINDOW_DAYS);
  const to = new Date(statementLine.transactionDate + "T00:00:00Z");
  to.setUTCDate(to.getUTCDate() + DATE_WINDOW_DAYS);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const alreadyMatched = await db.select({ id: bankReconciliationMatchJournalLines.journalLineId }).from(bankReconciliationMatchJournalLines);
  const excludeIds = alreadyMatched.map((r) => r.id);

  const rows = await db
    .select({
      journalLineId: journalLines.id,
      journalEntryId: journalEntries.id,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.memo,
      referenceNumber: journalEntries.referenceNumber,
      description: journalLines.description,
      debitAmount: journalLines.debitAmount,
      creditAmount: journalLines.creditAmount,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalLines.accountId, chartAccountId),
        eq(journalEntries.isReversed, false),
        isNull(journalEntries.reversalOfId),
        gte(journalEntries.entryDate, fromStr),
        lte(journalEntries.entryDate, toStr),
        excludeIds.length > 0 ? notInArray(journalLines.id, excludeIds) : sql`true`
      )
    );

  const candidates: MatchCandidate[] = [];
  for (const r of rows) {
    const signedAmount = round2(Number(r.debitAmount) - Number(r.creditAmount));
    if (Math.abs(signedAmount - round2(statementLine.amount)) > 0.01) continue;

    let score = 50; // amount-exact baseline
    const dateDiff = daysBetween(r.entryDate, statementLine.transactionDate);
    if (dateDiff === 0) score += 20;
    else if (dateDiff <= 3) score += 10;
    else if (dateDiff <= 7) score += 5;

    if (statementLine.reference && r.referenceNumber) {
      const refScore = textOverlapScore(statementLine.reference, r.referenceNumber);
      score += refScore * 20;
    }

    const descScore = Math.max(
      textOverlapScore(statementLine.description, r.description ?? ""),
      textOverlapScore(statementLine.description, r.memo ?? "")
    );
    score += descScore * 10;

    score = Math.min(100, Math.round(score));
    if (score < 50) continue;

    candidates.push({
      journalLineId: r.journalLineId,
      journalEntryId: r.journalEntryId,
      entryDate: r.entryDate,
      memo: r.memo,
      referenceNumber: r.referenceNumber,
      description: r.description,
      signedAmount,
      score,
      tier: score >= 90 ? "exact" : "suggested",
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
