import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetDisposals, assetEvents, assets, customers } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { monthLabel, monthRange, todayIso, validateADDate, type CalendarSystem, type IsoDate } from "@/lib/calendar";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertCashBankAccounts } from "@/lib/ledger/account-guards";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { salesVatRate } from "@/lib/sales/vat";
import { ASSET_ROLES, getAssetAccount } from "./accounts";
import { checkDisposal, disposalAmounts, type DisposalKind } from "./disposal-math";
import { assetRunAmount } from "./run-math";

// Selling, disposing of and writing off an asset. All three take the asset off the books in one ledger entry:
//   Dr Accumulated Depreciation, Dr cash/bank (sales), Cr Fixed Assets (cost), Cr Tax Payable (VAT on a sale),
//   and the difference to Gain on Disposal (Cr) or Loss on Disposal (Dr).
// An asset isn't depreciated in the month it leaves, so every earlier month must already be posted.

const round2 = (n: number) => Math.round(n * 100) / 100;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isMessage = (e: unknown) => e instanceof Error && Object.getPrototypeOf(e) === Error.prototype;
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};
const dayBefore = (iso: IsoDate): IsoDate => new Date(new Date(`${iso}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

const PREFIX: Record<DisposalKind, string> = { sale: "SALE", disposal: "DISP", write_off: "WOFF" };
const STATUS_AFTER = { sale: "sold", disposal: "disposed", write_off: "written_off" } as const;
const VERB: Record<DisposalKind, string> = { sale: "sold", disposal: "disposed of", write_off: "written off" };

export type AssetDisposalInput = {
  assetId: string;
  kind: DisposalKind;
  disposalDate: string;
  // sale
  customerId?: string | null;
  invoiceNumber?: string;
  taxable?: boolean;
  salePrice?: number;
  receivedAccountId?: string | null;
  // disposal / write-off
  reason?: string;
};
export type AssetDisposalResult = { ok: true; disposalId: string; reference: string; gainLoss: number } | { ok: false; error: string };

export async function disposeAsset(tenantId: string, userId: string, calendar: CalendarSystem, input: AssetDisposalInput): Promise<AssetDisposalResult> {
  let disposalId: string | null = null;
  try {
    const [asset] = await db.select().from(assets).where(and(eq(assets.id, input.assetId), eq(assets.tenantId, tenantId))).limit(1);
    if (!asset) return fail("Choose the asset.");
    if (asset.status !== "active" && asset.status !== "fully_depreciated") return fail(`${asset.assetCode} is ${asset.status.replace("_", " ")}, so it can't be ${VERB[input.kind]}.`);

    const date = input.disposalDate;
    if (!date || !validateADDate(date)) return fail("Enter the date.");
    if (date > todayIso()) return fail("The date can't be in the future.");
    const [{ first }] = await db
      .select({ first: sql<string | null>`min(${assetEvents.eventDate})` })
      .from(assetEvents)
      .where(and(eq(assetEvents.assetId, asset.id), inArray(assetEvents.eventType, ["purchased", "opening_recorded"])));
    if (first && date < first) return fail(`The asset only entered the books on ${first}, so it can't be ${VERB[input.kind]} before that.`);

    // Depreciation must be up to date through the month before, and not already posted into the month it leaves.
    if (asset.lastDepreciationDate && date <= asset.lastDepreciationDate) return fail(`Depreciation is already posted through ${asset.lastDepreciationDate}, which is on or after this date. Reverse those depreciation runs first.`);
    const previousEnd = dayBefore(monthRange(calendar, date).from);
    const due = assetRunAmount(
      { cost: Number(asset.capitalizedCost), residual: Number(asset.residualValue), openingAccumulated: Number(asset.openingAccumulatedDepreciation), accumulated: Number(asset.accumulatedDepreciation), method: asset.depreciationMethod, months: asset.usefulLifeMonths, startDate: asset.depreciationStartDate, lastDepreciationDate: asset.lastDepreciationDate },
      previousEnd,
      calendar
    );
    if (due) return fail(`Post depreciation through ${monthLabel(calendar, previousEnd)} first (Assets > Depreciation), so the asset is at its correct book value when it is ${VERB[input.kind]}.`);

    const problem = checkDisposal({ kind: input.kind, proceeds: input.salePrice ?? 0, reason: input.reason ?? "", receivedAccountId: input.receivedAccountId ?? null });
    if (problem) return fail(problem);
    if (input.kind === "sale") {
      await assertCashBankAccounts(tenantId, [input.receivedAccountId!]);
      if (input.customerId) {
        const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!c) return fail("Choose a customer of this organization.");
      }
    }
    await assertPeriodOpen(tenantId, date);

    const cost = Number(asset.capitalizedCost);
    const accumulated = Number(asset.accumulatedDepreciation);
    const proceeds = input.kind === "sale" ? round2(input.salePrice ?? 0) : 0;
    const vatRate = input.kind === "sale" && input.taxable ? await salesVatRate(tenantId, date) : 0;
    const { netBookValue, vat, total, gainLoss } = disposalAmounts({ cost, accumulated, proceeds, vatRate });

    const [costAccount, accumAccount] = await Promise.all([getAssetAccount(tenantId, ASSET_ROLES.cost), getAssetAccount(tenantId, ASSET_ROLES.accumulatedDepreciation)]);
    const gainAccount = gainLoss > 0 ? await getAssetAccount(tenantId, ASSET_ROLES.gainOnDisposal) : null;
    const lossAccount = gainLoss < 0 ? await getAssetAccount(tenantId, ASSET_ROLES.lossOnDisposal) : null;
    let taxPayableId: string | null = null;
    if (vat > 0) {
      const taxPayable = await findControlAccount(tenantId, ["2100"], "Tax Payable");
      if (!taxPayable) return fail("No Tax Payable account found — add one to the Chart of Accounts first.");
      taxPayableId = taxPayable.id;
    }

    // The disposal row first (its reference is unique); posted entry second.
    let row: typeof assetDisposals.$inferSelect | undefined;
    for (let attempt = 0; attempt < 4 && !row; attempt++) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assetDisposals).where(eq(assetDisposals.tenantId, tenantId));
      const reference = `${PREFIX[input.kind]}-${String(n + 1 + attempt).padStart(6, "0")}`;
      try {
        [row] = await db
          .insert(assetDisposals)
          .values({
            tenantId,
            assetId: asset.id,
            kind: input.kind,
            reference,
            disposalDate: date,
            customerId: input.kind === "sale" ? input.customerId || null : null,
            invoiceNumber: input.kind === "sale" ? input.invoiceNumber?.trim() || null : null,
            taxTreatment: vat > 0 ? "taxable" : "none",
            saleAmount: proceeds.toFixed(2),
            vatAmount: vat.toFixed(2),
            total: total.toFixed(2),
            receivedAccountId: input.kind === "sale" ? input.receivedAccountId : null,
            cost: cost.toFixed(2),
            accumulatedDepreciation: accumulated.toFixed(2),
            netBookValue: netBookValue.toFixed(2),
            gainLoss: gainLoss.toFixed(2),
            reason: input.reason?.trim() || null,
            createdBy: userId,
          })
          .returning();
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    if (!row) return fail("Could not allocate a reference; please try again.");
    disposalId = row.id;

    const label = `${asset.assetCode} ${VERB[input.kind]}`;
    const lines: PostLineInput[] = [];
    if (accumulated > 0) lines.push({ accountId: accumAccount.id, debitAmount: accumulated, description: label });
    if (input.kind === "sale" && total > 0) lines.push({ accountId: input.receivedAccountId!, debitAmount: total, description: label });
    if (lossAccount) lines.push({ accountId: lossAccount.id, debitAmount: round2(-gainLoss), description: `Loss on ${label}` });
    lines.push({ accountId: costAccount.id, creditAmount: cost, description: label });
    if (taxPayableId) lines.push({ accountId: taxPayableId, creditAmount: vat, description: `VAT on ${label}` });
    if (gainAccount) lines.push({ accountId: gainAccount.id, creditAmount: gainLoss, description: `Gain on ${label}` });

    const entry = await postJournalEntry({
      tenantId,
      entryDate: date,
      sourceType: input.kind === "write_off" ? "asset_writeoff" : "asset_disposal",
      sourceId: row.id,
      referenceNumber: row.reference,
      memo: `${input.kind === "sale" ? "Sale" : input.kind === "write_off" ? "Write-off" : "Disposal"} of ${asset.assetCode} — ${asset.name}`,
      createdBy: userId,
      lines,
    });
    await db.update(assetDisposals).set({ journalEntryId: entry.id }).where(eq(assetDisposals.id, row.id));
    await db.update(assets).set({ status: STATUS_AFTER[input.kind], updatedAt: new Date() }).where(eq(assets.id, asset.id));
    await db.insert(assetEvents).values({
      tenantId,
      assetId: asset.id,
      eventType: input.kind === "sale" ? "sold" : input.kind === "write_off" ? "written_off" : "disposed",
      eventDate: date,
      description:
        input.kind === "sale"
          ? `Sold for ${proceeds.toFixed(2)}${vat > 0 ? ` + VAT ${vat.toFixed(2)}` : ""} (net book value ${netBookValue.toFixed(2)}, ${gainLoss >= 0 ? "gain" : "loss"} ${Math.abs(gainLoss).toFixed(2)})`
          : `${input.kind === "write_off" ? "Written off" : "Disposed of"}: ${input.reason?.trim()} (loss ${netBookValue.toFixed(2)})`,
      amount: (input.kind === "sale" ? proceeds : netBookValue).toFixed(2),
      journalEntryId: entry.id,
      createdBy: userId,
    });
    await logAuditEvent({
      tenantId,
      userId,
      action: `asset_${input.kind}`,
      entityType: "asset",
      entityId: asset.id,
      before: { status: asset.status },
      after: { status: STATUS_AFTER[input.kind], reference: row.reference, proceeds, netBookValue, gainLoss },
    });
    return { ok: true, disposalId: row.id, reference: row.reference, gainLoss };
  } catch (e) {
    if (disposalId) {
      await reverseAllActiveEntriesForSource(tenantId, disposalId, userId, "Disposal could not be saved").catch(() => {});
      await db.delete(assetDisposals).where(eq(assetDisposals.id, disposalId)).catch(() => {});
    }
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}

/** Undoes a sale, disposal or write-off: the entry is reversed and the asset is back on the register. */
export async function reverseAssetDisposal(tenantId: string, userId: string, disposalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const [row] = await db.select().from(assetDisposals).where(and(eq(assetDisposals.id, disposalId), eq(assetDisposals.tenantId, tenantId))).limit(1);
    if (!row) return fail("Not found.");
    if (row.status !== "posted") return fail("This has already been reversed.");
    const [asset] = await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1);
    if (!asset) return fail("Asset not found.");

    await assertPeriodOpen(tenantId, row.disposalDate);
    await assertPeriodOpen(tenantId, todayIso());
    await reverseAllActiveEntriesForSource(tenantId, row.id, userId, `Reversal of ${row.reference}`);
    const live = round2(Number(asset.capitalizedCost) - Number(asset.residualValue) - Number(asset.accumulatedDepreciation)) <= 0 && asset.depreciationMethod !== "none";
    await db.update(assets).set({ status: live ? "fully_depreciated" : "active", updatedAt: new Date() }).where(eq(assets.id, asset.id));
    await db.update(assetDisposals).set({ status: "reversed", reversedBy: userId, reversedAt: new Date() }).where(eq(assetDisposals.id, row.id));
    await db.insert(assetEvents).values({ tenantId, assetId: asset.id, eventType: "disposal_reversed", eventDate: todayIso(), description: `${row.reference} reversed; the asset is back on the register`, createdBy: userId });
    await logAuditEvent({ tenantId, userId, action: "asset_disposal_reversed", entityType: "asset", entityId: asset.id, before: { status: asset.status, reference: row.reference }, after: { status: live ? "fully_depreciated" : "active" } });
    return { ok: true };
  } catch (e) {
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}

export async function listDisposals(tenantId: string, limit = 50) {
  const rows = await db
    .select({
      id: assetDisposals.id,
      kind: assetDisposals.kind,
      reference: assetDisposals.reference,
      disposalDate: assetDisposals.disposalDate,
      status: assetDisposals.status,
      saleAmount: assetDisposals.saleAmount,
      vatAmount: assetDisposals.vatAmount,
      netBookValue: assetDisposals.netBookValue,
      gainLoss: assetDisposals.gainLoss,
      assetId: assets.id,
      assetCode: assets.assetCode,
      assetName: assets.name,
      customerName: customers.name,
    })
    .from(assetDisposals)
    .innerJoin(assets, eq(assets.id, assetDisposals.assetId))
    .leftJoin(customers, eq(customers.id, assetDisposals.customerId))
    .where(eq(assetDisposals.tenantId, tenantId))
    .orderBy(sql`${assetDisposals.disposalDate} desc, ${assetDisposals.createdAt} desc`)
    .limit(limit);
  return rows.map((r) => ({ ...r, saleAmount: Number(r.saleAmount), vatAmount: Number(r.vatAmount), netBookValue: Number(r.netBookValue), gainLoss: Number(r.gainLoss) }));
}
