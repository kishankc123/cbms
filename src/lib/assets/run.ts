import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetDepreciationLines, assetDepreciationRuns, assetEvents, assets } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addMonths, monthLabel, monthRange, todayIso, type CalendarSystem, type IsoDate } from "@/lib/calendar";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { postJournalEntry, reverseAllActiveEntriesForSource } from "@/lib/ledger/post";
import { ASSET_ROLES, getAssetAccount } from "./accounts";
import { assetRunAmount } from "./run-math";

// Monthly book depreciation. One run = one ledger entry (Dr Depreciation Expense / Cr Accumulated Depreciation) for the
// whole organization; the per-asset amounts live in asset_depreciation_lines. Runs go month by month in order, an asset that
// is behind catches up inside the next run, and only the latest run can be reversed, so the register never drifts.

const round2 = (n: number) => Math.round(n * 100) / 100;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isMessage = (e: unknown) => e instanceof Error && Object.getPrototypeOf(e) === Error.prototype;
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};
const dayAfter = (iso: IsoDate): IsoDate => new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const CHUNK = 500;

export async function latestPostedRun(tenantId: string) {
  const [run] = await db
    .select()
    .from(assetDepreciationRuns)
    .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.status, "posted")))
    .orderBy(desc(assetDepreciationRuns.periodEnd))
    .limit(1);
  return run ?? null;
}

export type RunLine = { assetId: string; assetCode: string; name: string; months: number; amount: number; accumulatedAfter: number; netBookValueAfter: number };

/** The run that would be posted for the month containing `anchor`, or why it can't be run. */
export async function previewRun(tenantId: string, calendar: CalendarSystem, anchor: IsoDate) {
  const range = monthRange(calendar, anchor);
  const period = { start: range.from, end: range.to, label: monthLabel(calendar, anchor) };
  if (period.end > todayIso()) return { period, lines: [] as RunLine[], total: 0, blocked: `${period.label} hasn't ended yet. Depreciation is posted for a month once it is over.` };
  const latest = await latestPostedRun(tenantId);
  if (latest && period.end <= latest.periodEnd) return { period, lines: [] as RunLine[], total: 0, blocked: `Depreciation has already been run through ${latest.periodLabel}.` };

  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.tenantId, tenantId), eq(assets.status, "active"), ne(assets.depreciationMethod, "none"), sql`${assets.depreciationStartDate} is not null and ${assets.depreciationStartDate} <= ${period.end}`))
    .orderBy(asc(assets.assetCode));

  const lines: RunLine[] = [];
  for (const a of rows) {
    const r = assetRunAmount(
      {
        cost: Number(a.capitalizedCost),
        residual: Number(a.residualValue),
        openingAccumulated: Number(a.openingAccumulatedDepreciation),
        accumulated: Number(a.accumulatedDepreciation),
        method: a.depreciationMethod,
        months: a.usefulLifeMonths,
        startDate: a.depreciationStartDate,
        lastDepreciationDate: a.lastDepreciationDate,
      },
      period.end,
      calendar
    );
    if (r) lines.push({ assetId: a.id, assetCode: a.assetCode, name: a.name, months: r.months, amount: r.amount, accumulatedAfter: r.accumulatedAfter, netBookValueAfter: round2(Number(a.capitalizedCost) - r.accumulatedAfter) });
  }
  return { period, lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)), blocked: null as string | null };
}

/** The months that can be run next, oldest first (the first one is the natural next run). */
export async function runnableMonths(tenantId: string, calendar: CalendarSystem) {
  const latest = await latestPostedRun(tenantId);
  let start: IsoDate | null = latest ? dayAfter(latest.periodEnd) : null;
  if (!start) {
    const [first] = await db
      .select({ d: sql<string | null>`min(${assets.depreciationStartDate})` })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.status, "active"), ne(assets.depreciationMethod, "none")));
    start = first?.d ?? null;
  }
  if (!start) return [];
  const months: { anchor: IsoDate; label: string }[] = [];
  const today = todayIso();
  for (let i = 0; i < 36; i++) {
    const anchor = addMonths(calendar, start, i);
    const range = monthRange(calendar, anchor);
    if (range.to > today) break;
    months.push({ anchor: range.from, label: monthLabel(calendar, anchor) });
  }
  return months;
}

export async function listRuns(tenantId: string, limit = 24) {
  const rows = await db.select().from(assetDepreciationRuns).where(eq(assetDepreciationRuns.tenantId, tenantId)).orderBy(desc(assetDepreciationRuns.runNumber)).limit(limit);
  return rows.map((r) => ({ id: r.id, runNumber: r.runNumber, periodLabel: r.periodLabel, periodEnd: r.periodEnd, totalAmount: Number(r.totalAmount), assetCount: r.assetCount, status: r.status, createdAt: r.createdAt.toISOString() }));
}

export async function depreciationSummary(tenantId: string) {
  const [[posted], [status]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${assetDepreciationRuns.totalAmount}), 0)` })
      .from(assetDepreciationRuns)
      .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.status, "posted"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.status, "active"), ne(assets.depreciationMethod, "none"))),
  ]);
  return { totalPosted: round2(Number(posted.total)), depreciatingAssets: status.n };
}

export type RunResult = { ok: true; runId: string; runNumber: number; total: number; assetCount: number } | { ok: false; error: string };

export async function postDepreciationRun(tenantId: string, userId: string, calendar: CalendarSystem, anchor: IsoDate): Promise<RunResult> {
  let runId: string | null = null;
  try {
    const preview = await previewRun(tenantId, calendar, anchor);
    if (preview.blocked) return fail(preview.blocked);
    if (preview.lines.length === 0) return fail(`No asset has depreciation due through ${preview.period.label}.`);
    await assertPeriodOpen(tenantId, preview.period.end);

    const [expense, accumulated] = await Promise.all([getAssetAccount(tenantId, ASSET_ROLES.depreciationExpense), getAssetAccount(tenantId, ASSET_ROLES.accumulatedDepreciation)]);
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${assetDepreciationRuns.runNumber}), 0)::int` }).from(assetDepreciationRuns).where(eq(assetDepreciationRuns.tenantId, tenantId));
    const runNumber = n + 1;

    // The run row first: its unique month stops a second click or a second person posting the same month.
    let run: typeof assetDepreciationRuns.$inferSelect;
    try {
      [run] = await db
        .insert(assetDepreciationRuns)
        .values({ tenantId, runNumber, periodStart: preview.period.start, periodEnd: preview.period.end, periodLabel: preview.period.label, totalAmount: preview.total.toFixed(2), assetCount: preview.lines.length, createdBy: userId })
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) return fail(`Depreciation for ${preview.period.label} has just been posted by someone else.`);
      throw e;
    }
    runId = run.id;

    const entry = await postJournalEntry({
      tenantId,
      entryDate: preview.period.end,
      sourceType: "asset_depreciation",
      sourceId: run.id,
      referenceNumber: `DEP-${String(runNumber).padStart(6, "0")}`,
      memo: `Depreciation for ${preview.period.label} (${preview.lines.length} asset${preview.lines.length === 1 ? "" : "s"})`,
      createdBy: userId,
      lines: [
        { accountId: expense.id, debitAmount: preview.total, description: `Depreciation ${preview.period.label}` },
        { accountId: accumulated.id, creditAmount: preview.total, description: `Depreciation ${preview.period.label}` },
      ],
    });
    await db.update(assetDepreciationRuns).set({ journalEntryId: entry.id }).where(eq(assetDepreciationRuns.id, run.id));

    for (let i = 0; i < preview.lines.length; i += CHUNK) {
      const part = preview.lines.slice(i, i + CHUNK);
      await db.insert(assetDepreciationLines).values(part.map((l) => ({ runId: run.id, tenantId, assetId: l.assetId, months: l.months, amount: l.amount.toFixed(2), accumulatedAfter: l.accumulatedAfter.toFixed(2) })));
      // One statement moves every asset in the chunk: running accumulated depreciation, the last month posted, and the status.
      const values = sql.join(part.map((l) => sql`(${l.assetId}::uuid, ${l.amount.toFixed(2)}::numeric)`), sql`, `);
      await db.execute(sql`
        update assets set
          accumulated_depreciation = assets.accumulated_depreciation + v.amt,
          last_depreciation_date = ${preview.period.end},
          status = case when assets.capitalized_cost - assets.residual_value - (assets.accumulated_depreciation + v.amt) <= 0 then 'fully_depreciated'::asset_status else assets.status end,
          updated_at = now()
        from (values ${values}) as v(id, amt)
        where assets.id = v.id and assets.tenant_id = ${tenantId}`);
      await db.insert(assetEvents).values(
        part.map((l) => ({
          tenantId,
          assetId: l.assetId,
          eventType: "depreciation_posted",
          eventDate: preview.period.end,
          description: `Depreciation for ${preview.period.label}${l.months > 1 ? ` (${l.months} months)` : ""}`,
          amount: l.amount.toFixed(2),
          journalEntryId: entry.id,
          createdBy: userId,
        }))
      );
    }
    await logAuditEvent({ tenantId, userId, action: "asset_depreciation_posted", entityType: "asset_depreciation_run", entityId: run.id, after: { runNumber, period: preview.period.label, total: preview.total, assets: preview.lines.length } });
    return { ok: true, runId: run.id, runNumber, total: preview.total, assetCount: preview.lines.length };
  } catch (e) {
    if (runId) await undoPartialRun(tenantId, userId, runId);
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}

/** A run that failed part-way leaves nothing behind: its entry is reversed, any asset already moved is moved back, and the run row goes. */
async function undoPartialRun(tenantId: string, userId: string, runId: string) {
  try {
    const done = await db.select().from(assetDepreciationLines).where(eq(assetDepreciationLines.runId, runId));
    if (done.length > 0) await restoreAssets(tenantId, runId, done);
    await reverseAllActiveEntriesForSource(tenantId, runId, userId, "Depreciation run failed and was undone");
    await db.delete(assetDepreciationRuns).where(eq(assetDepreciationRuns.id, runId));
  } catch {
    // Nothing more can be done here; the original error is what gets reported.
  }
}

/** Takes a run's amounts back off its assets: accumulated depreciation, the last-posted date (to the one before) and the status. */
async function restoreAssets(tenantId: string, runId: string, lines: { assetId: string; amount: string }[]) {
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK);
    const values = sql.join(part.map((l) => sql`(${l.assetId}::uuid, ${l.amount}::numeric)`), sql`, `);
    await db.execute(sql`
      update assets set
        accumulated_depreciation = assets.accumulated_depreciation - v.amt,
        last_depreciation_date = (
          select max(r.period_end) from asset_depreciation_lines l join asset_depreciation_runs r on r.id = l.run_id
          where l.asset_id = assets.id and r.status = 'posted' and r.id <> ${runId}::uuid),
        status = case when assets.status = 'fully_depreciated' then 'active'::asset_status else assets.status end,
        updated_at = now()
      from (values ${values}) as v(id, amt)
      where assets.id = v.id and assets.tenant_id = ${tenantId}`);
  }
}

/** Reverses the latest posted run (Dr Accumulated Depreciation / Cr Depreciation Expense) and gives its months back to the assets. */
export async function reverseDepreciationRun(tenantId: string, userId: string, runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const [run] = await db.select().from(assetDepreciationRuns).where(and(eq(assetDepreciationRuns.id, runId), eq(assetDepreciationRuns.tenantId, tenantId))).limit(1);
    if (!run) return fail("Depreciation run not found.");
    if (run.status !== "posted") return fail("This run has already been reversed.");
    const latest = await latestPostedRun(tenantId);
    if (latest?.id !== run.id) return fail(`Only the latest run can be reversed. Reverse the run for ${latest?.periodLabel} first.`);

    const lines = await db.select().from(assetDepreciationLines).where(eq(assetDepreciationLines.runId, run.id));
    const retired = await db
      .select({ code: assets.assetCode })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), inArray(assets.id, lines.map((l) => l.assetId)), inArray(assets.status, ["disposed", "sold", "written_off", "voided"])));
    if (retired.length > 0) return fail(`${retired[0].code} has been disposed of since this run, so the run can't be reversed.`);

    await assertPeriodOpen(tenantId, run.periodEnd);
    await assertPeriodOpen(tenantId, todayIso());
    await reverseAllActiveEntriesForSource(tenantId, run.id, userId, `Reversal of depreciation run ${run.runNumber} (${run.periodLabel})`);
    await restoreAssets(tenantId, run.id, lines);
    await db.update(assetDepreciationRuns).set({ status: "reversed", reversedBy: userId, reversedAt: new Date() }).where(eq(assetDepreciationRuns.id, run.id));
    for (let i = 0; i < lines.length; i += CHUNK) {
      await db.insert(assetEvents).values(
        lines.slice(i, i + CHUNK).map((l) => ({ tenantId, assetId: l.assetId, eventType: "depreciation_reversed", eventDate: todayIso(), description: `Depreciation for ${run.periodLabel} reversed`, amount: l.amount, createdBy: userId }))
      );
    }
    await logAuditEvent({ tenantId, userId, action: "asset_depreciation_reversed", entityType: "asset_depreciation_run", entityId: run.id, before: { status: "posted", total: Number(run.totalAmount) }, after: { status: "reversed" } });
    return { ok: true };
  } catch (e) {
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}
