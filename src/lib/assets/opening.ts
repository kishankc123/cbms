import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetEvents, assetLocations, assets, journalEntries, journalLines } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { todayIso } from "@/lib/calendar";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { postJournalEntry, reverseLatestEntryForSource, type PostLineInput } from "@/lib/ledger/post";
import { openingBalanceEntryDate } from "@/lib/ledger/opening-balance";
import { ASSET_ROLES, getAssetAccount } from "./accounts";
import { nextAssetCode } from "./next-code";
import { checkOpeningAsset, openingAssetAmounts } from "./opening-math";
import { LIVE_STATUSES } from "./register";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OpeningAssetInput = {
  name: string;
  description?: string;
  categoryId: string;
  locationId?: string | null;
  /** Leave empty to number it automatically. */
  assetCode?: string;
  originalPurchaseDate: string;
  supportingDocument?: string;
  cost: number;
  accumulatedDepreciation: number;
  method: "straight_line" | "declining_balance" | "none";
  originalUsefulLifeMonths: number | null;
  remainingUsefulLifeMonths: number | null;
  residualValue: number;
  /** The date depreciation carries on from. */
  depreciationStartDate: string | null;
};
export type OpeningAssetResult = { ok: true; assetId: string; assetCode: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};
const isMessage = (e: unknown) => e instanceof Error && Object.getPrototypeOf(e) === Error.prototype;

async function validate(tenantId: string, input: OpeningAssetInput, openingDate: string): Promise<string | null> {
  const problem = checkOpeningAsset({
    name: input.name,
    originalPurchaseDate: input.originalPurchaseDate,
    openingDate,
    cost: input.cost,
    accumulated: input.accumulatedDepreciation,
    residual: input.residualValue,
    method: input.method,
    originalUsefulLifeMonths: input.originalUsefulLifeMonths,
    remainingUsefulLifeMonths: input.remainingUsefulLifeMonths,
    depreciationStartDate: input.depreciationStartDate,
  });
  if (problem) return problem;
  if (!input.categoryId) return "Choose an asset category.";
  const [category] = await db.select().from(assetCategories).where(and(eq(assetCategories.id, input.categoryId), eq(assetCategories.tenantId, tenantId))).limit(1);
  if (!category) return "Choose an asset category.";
  if (!category.isActive) return `The category "${category.name}" is inactive; choose an active one.`;
  if (input.locationId) {
    const [location] = await db.select().from(assetLocations).where(and(eq(assetLocations.id, input.locationId), eq(assetLocations.tenantId, tenantId))).limit(1);
    if (!location || !location.isActive) return "Choose an active location.";
  }
  return null;
}

/** The columns an opening asset's figures decide. Fully depreciated assets keep no schedule; they only stay on the books. */
function figures(input: OpeningAssetInput) {
  const { fullyDepreciated } = openingAssetAmounts({ cost: input.cost, accumulated: input.accumulatedDepreciation, residual: input.residualValue });
  const depreciating = input.method !== "none" && !fullyDepreciated;
  return {
    status: (input.method !== "none" && fullyDepreciated ? "fully_depreciated" : "active") as "fully_depreciated" | "active",
    purchasePrice: input.cost.toFixed(2),
    capitalizedCost: input.cost.toFixed(2),
    openingAccumulatedDepreciation: input.accumulatedDepreciation.toFixed(2),
    accumulatedDepreciation: input.accumulatedDepreciation.toFixed(2),
    depreciationMethod: input.method,
    usefulLifeMonths: depreciating ? input.remainingUsefulLifeMonths : null,
    originalUsefulLifeMonths: input.method !== "none" ? input.originalUsefulLifeMonths : null,
    residualValue: (input.method !== "none" ? input.residualValue : 0).toFixed(2),
    depreciationStartDate: depreciating ? input.depreciationStartDate : null,
  };
}

/** Dr cost / Cr accumulated depreciation / Cr the opening-balance adjustment (equity) for the net book value. */
async function postOpeningEntry(tenantId: string, userId: string, asset: { id: string; assetCode: string; name: string }, input: OpeningAssetInput, openingDate: string) {
  const [costAccount, accumAccount, adjustment] = await Promise.all([getAssetAccount(tenantId, ASSET_ROLES.cost), getAssetAccount(tenantId, ASSET_ROLES.accumulatedDepreciation), getAssetAccount(tenantId, ASSET_ROLES.openingAdjustment)]);
  const label = `Opening asset ${asset.assetCode}`;
  const nbv = round2(input.cost - input.accumulatedDepreciation);
  const lines: PostLineInput[] = [{ accountId: costAccount.id, debitAmount: round2(input.cost), description: label }];
  if (input.accumulatedDepreciation > 0) lines.push({ accountId: accumAccount.id, creditAmount: round2(input.accumulatedDepreciation), description: label });
  if (nbv > 0) lines.push({ accountId: adjustment.id, creditAmount: nbv, description: label });
  return postJournalEntry({
    tenantId,
    entryDate: openingDate,
    sourceType: "opening_balance",
    sourceId: asset.id,
    referenceNumber: `OPEN-${asset.assetCode}`,
    memo: `${label} — ${asset.name}`,
    createdBy: userId,
    lines,
  });
}

/**
 * Brings an asset in from before the books started: the cost it was bought for and the depreciation already taken. The
 * net book value is balanced against the same opening-balance (Brought forward) account customers and suppliers use,
 * and depreciation carries on from the remaining life, so the past is never recomputed.
 */
export async function recordOpeningAsset(tenantId: string, userId: string, input: OpeningAssetInput): Promise<OpeningAssetResult> {
  try {
    const openingDate = await openingBalanceEntryDate(tenantId);
    const problem = await validate(tenantId, input, openingDate);
    if (problem) return fail(problem);
    await assertPeriodOpen(tenantId, openingDate);

    const manualCode = (input.assetCode ?? "").trim();
    const f = figures(input);
    let asset: typeof assets.$inferSelect | undefined;
    for (let attempt = 0; attempt < 4 && !asset; attempt++) {
      const assetCode = manualCode || (await nextAssetCode(tenantId, attempt));
      try {
        [asset] = await db
          .insert(assets)
          .values({
            tenantId,
            assetCode,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            categoryId: input.categoryId,
            locationId: input.locationId || null,
            source: "opening",
            purchaseDate: input.originalPurchaseDate,
            availableForUseDate: input.originalPurchaseDate,
            supportingDocument: input.supportingDocument?.trim() || null,
            createdBy: userId,
            ...f,
            status: "draft",
          })
          .returning();
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (manualCode) return fail(`Asset code ${manualCode} is already used.`);
      }
    }
    if (!asset) return fail("Could not allocate an asset code; please try again.");

    try {
      const entry = await postOpeningEntry(tenantId, userId, asset, input, openingDate);
      await db.update(assets).set({ status: f.status, updatedAt: new Date() }).where(eq(assets.id, asset.id));
      await db.insert(assetEvents).values({
        tenantId,
        assetId: asset.id,
        eventType: "opening_recorded",
        eventDate: openingDate,
        description: `Brought in at cost ${input.cost.toFixed(2)} with accumulated depreciation ${input.accumulatedDepreciation.toFixed(2)}`,
        amount: round2(input.cost - input.accumulatedDepreciation).toFixed(2),
        journalEntryId: entry.id,
        createdBy: userId,
      });
      await logAuditEvent({ tenantId, userId, action: "asset_opening_recorded", entityType: "asset", entityId: asset.id, after: { assetCode: asset.assetCode, name: asset.name, cost: input.cost, accumulatedDepreciation: input.accumulatedDepreciation } });
    } catch (e) {
      await db.delete(assets).where(eq(assets.id, asset.id));
      throw e;
    }
    return { ok: true, assetId: asset.id, assetCode: asset.assetCode };
  } catch (e) {
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}

async function loadEditable(tenantId: string, assetId: string, verb: string) {
  const [asset] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId))).limit(1);
  if (!asset) return { error: "Asset not found." } as const;
  if (asset.source !== "opening") return { error: "Only an opening asset can be changed here." } as const;
  if (!LIVE_STATUSES.includes(asset.status)) return { error: `This asset is ${asset.status.replace("_", " ")}, so it can't be ${verb}.` } as const;
  if (asset.lastDepreciationDate) return { error: `Depreciation has already been posted for this asset, so its opening figures can't be ${verb}.` } as const;
  return { asset } as const;
}

/** Corrects an opening asset's figures: the opening entry is reversed and posted again, and the change is audit-logged. */
export async function updateOpeningAsset(tenantId: string, userId: string, assetId: string, input: OpeningAssetInput): Promise<OpeningAssetResult> {
  try {
    const loaded = await loadEditable(tenantId, assetId, "changed");
    if (!loaded.asset) return fail(loaded.error ?? "Asset not found.");
    const old = loaded.asset;

    const openingDate = await openingBalanceEntryDate(tenantId);
    const problem = await validate(tenantId, input, openingDate);
    if (problem) return fail(problem);
    await assertPeriodOpen(tenantId, openingDate);

    const code = (input.assetCode ?? "").trim() || old.assetCode;
    if (code !== old.assetCode) {
      const [clash] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.tenantId, tenantId), eq(assets.assetCode, code))).limit(1);
      if (clash) return fail(`Asset code ${code} is already used.`);
    }

    await reverseLatestEntryForSource(tenantId, "opening_balance", old.id, userId, `Opening asset ${old.assetCode} corrected`);
    const f = figures(input);
    const [updated] = await db
      .update(assets)
      .set({
        assetCode: code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        categoryId: input.categoryId,
        locationId: input.locationId || null,
        purchaseDate: input.originalPurchaseDate,
        availableForUseDate: input.originalPurchaseDate,
        supportingDocument: input.supportingDocument?.trim() || null,
        ...f,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, old.id))
      .returning();
    const entry = await postOpeningEntry(tenantId, userId, updated, input, openingDate);
    await db.insert(assetEvents).values({
      tenantId,
      assetId: old.id,
      eventType: "opening_corrected",
      eventDate: todayIso(),
      description: `Opening figures corrected: cost ${old.capitalizedCost} → ${input.cost.toFixed(2)}, accumulated depreciation ${old.accumulatedDepreciation} → ${input.accumulatedDepreciation.toFixed(2)}`,
      amount: round2(input.cost - input.accumulatedDepreciation).toFixed(2),
      journalEntryId: entry.id,
      createdBy: userId,
    });
    await logAuditEvent({
      tenantId,
      userId,
      action: "asset_opening_updated",
      entityType: "asset",
      entityId: old.id,
      before: { assetCode: old.assetCode, name: old.name, cost: Number(old.capitalizedCost), accumulatedDepreciation: Number(old.accumulatedDepreciation), method: old.depreciationMethod, remainingLifeMonths: old.usefulLifeMonths },
      after: { assetCode: code, name: input.name.trim(), cost: input.cost, accumulatedDepreciation: input.accumulatedDepreciation, method: input.method, remainingLifeMonths: f.usefulLifeMonths },
    });
    return { ok: true, assetId: old.id, assetCode: code };
  } catch (e) {
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}

/** Takes an opening asset that was entered by mistake off the books (its entry is reversed; the record and history stay). */
export async function voidOpeningAsset(tenantId: string, userId: string, assetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const loaded = await loadEditable(tenantId, assetId, "voided");
    if (!loaded.asset) return fail(loaded.error ?? "Asset not found.");
    const asset = loaded.asset;
    await assertPeriodOpen(tenantId, await openingBalanceEntryDate(tenantId));
    await reverseLatestEntryForSource(tenantId, "opening_balance", asset.id, userId, `Opening asset ${asset.assetCode} voided`);
    await db.update(assets).set({ status: "voided", updatedAt: new Date() }).where(eq(assets.id, asset.id));
    await db.insert(assetEvents).values({ tenantId, assetId: asset.id, eventType: "voided", eventDate: todayIso(), description: "Opening asset voided", createdBy: userId });
    await logAuditEvent({ tenantId, userId, action: "asset_opening_voided", entityType: "asset", entityId: asset.id, before: { status: asset.status }, after: { status: "voided" } });
    return { ok: true };
  } catch (e) {
    if (isMessage(e)) return fail((e as Error).message);
    throw e;
  }
}

export async function listOpeningAssets(tenantId: string) {
  const rows = await db
    .select({
      id: assets.id,
      assetCode: assets.assetCode,
      name: assets.name,
      status: assets.status,
      purchaseDate: assets.purchaseDate,
      cost: assets.capitalizedCost,
      accumulated: assets.openingAccumulatedDepreciation,
      categoryName: assetCategories.name,
      locked: sql<boolean>`${assets.lastDepreciationDate} is not null`,
    })
    .from(assets)
    .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
    .where(and(eq(assets.tenantId, tenantId), eq(assets.source, "opening")))
    .orderBy(desc(assets.assetCode));
  return rows.map((r) => ({ ...r, cost: Number(r.cost), accumulated: Number(r.accumulated), netBookValue: round2(Number(r.cost) - Number(r.accumulated)) }));
}

/** What the register says against what the ledger says, for cost and accumulated depreciation. */
export async function assetLedgerReconciliation(tenantId: string) {
  const [costAccount, accumAccount, [register]] = await Promise.all([
    getAssetAccount(tenantId, ASSET_ROLES.cost),
    getAssetAccount(tenantId, ASSET_ROLES.accumulatedDepreciation),
    db
      .select({
        cost: sql<string>`coalesce(sum(${assets.capitalizedCost}), 0)`,
        accumulated: sql<string>`coalesce(sum(${assets.accumulatedDepreciation}), 0)`,
      })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), inArray(assets.status, LIVE_STATUSES))),
  ]);
  const ledgerOf = async (accountId: string) => {
    const [r] = await db
      .select({ net: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, accountId)));
    return Number(r.net);
  };
  const [ledgerCost, ledgerAccumNet] = await Promise.all([ledgerOf(costAccount.id), ledgerOf(accumAccount.id)]);
  const registerCost = round2(Number(register.cost));
  const registerAccumulated = round2(Number(register.accumulated));
  const ledgerAccumulated = round2(-ledgerAccumNet) + 0; // + 0 turns -0 into 0
  return {
    registerCost,
    ledgerCost: round2(ledgerCost),
    registerAccumulated,
    ledgerAccumulated,
    costDifference: round2(registerCost - ledgerCost),
    accumulatedDifference: round2(registerAccumulated - ledgerAccumulated),
    matches: Math.abs(registerCost - ledgerCost) < 0.005 && Math.abs(registerAccumulated - ledgerAccumulated) < 0.005,
  };
}
