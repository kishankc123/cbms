// Saving and loading the VAT worksheet. Load = work the year's figures out from the books and keep them as a draft; Save = make the
// draft the saved worksheet. The server keeps the draft itself, so Save never trusts figures sent back from the browser.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, vatWorksheets } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { buildVatWorksheet, computeVatWorksheetFigures, listVatWorksheetYears, vatBooksChangedSince, type VatWorksheet, type VatWorksheetYear } from "./vat-worksheet";

export type VatWorksheetState = {
  years: VatWorksheetYear[];
  selectedKey: string | null;
  /** The saved worksheet for the selected year, if there is one. */
  saved: { sheet: VatWorksheet; savedAt: string; savedBy: string | null; booksChanged: boolean } | null;
  /** A worksheet that was loaded from the books but not saved yet. */
  draft: { sheet: VatWorksheet; loadedAt: string; loadedBy: string | null } | null;
};

async function nameOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? null;
}

async function rowFor(tenantId: string, yearKey: string) {
  const [row] = await db.select().from(vatWorksheets).where(and(eq(vatWorksheets.tenantId, tenantId), eq(vatWorksheets.fiscalYearKey, yearKey))).limit(1);
  return row ?? null;
}

/** What to show for a year: its saved worksheet and/or its loaded draft. No ledger reads, so it is quick. */
export async function getVatWorksheetState(tenantId: string, requestedKey?: string | null): Promise<VatWorksheetState> {
  const { years, selected } = await listVatWorksheetYears(tenantId, requestedKey);
  if (!selected) return { years, selectedKey: null, saved: null, draft: null };
  const row = await rowFor(tenantId, selected.key);
  const [saved, draft] = await Promise.all([
    row?.data && row.savedAt
      ? (async () => ({
          sheet: await buildVatWorksheet(tenantId, row.data!),
          savedAt: row.savedAt!.toISOString(),
          savedBy: await nameOf(row.savedBy),
          booksChanged: await vatBooksChangedSince(tenantId, selected, row.savedAt!),
        }))()
      : Promise.resolve(null),
    row?.draft && row.draftLoadedAt
      ? (async () => ({ sheet: await buildVatWorksheet(tenantId, row.draft!), loadedAt: row.draftLoadedAt!.toISOString(), loadedBy: await nameOf(row.draftLoadedBy) }))()
      : Promise.resolve(null),
  ]);
  return { years, selectedKey: selected.key, saved, draft };
}

async function selectedYear(tenantId: string, yearKey: string): Promise<VatWorksheetYear> {
  const { years } = await listVatWorksheetYears(tenantId, yearKey);
  const year = years.find((y) => y.key === yearKey);
  if (!year) throw new Error("That fiscal year has no VAT periods.");
  return year;
}

/** Works the year out from the books and keeps it as the draft (replacing an earlier draft). Slow, on purpose: it is asked for. */
export async function loadVatWorksheet(tenantId: string, userId: string, yearKey: string) {
  const year = await selectedYear(tenantId, yearKey);
  const figures = await computeVatWorksheetFigures(tenantId, year);
  const now = new Date();
  const existing = await rowFor(tenantId, year.key);
  if (existing) {
    await db.update(vatWorksheets).set({ draft: figures, draftLoadedAt: now, draftLoadedBy: userId, fiscalYearLabel: year.label }).where(eq(vatWorksheets.id, existing.id));
  } else {
    await db.insert(vatWorksheets).values({ tenantId, fiscalYearKey: year.key, fiscalYearLabel: year.label, draft: figures, draftLoadedAt: now, draftLoadedBy: userId });
  }
}

/** Makes the loaded draft the saved worksheet. */
export async function saveVatWorksheet(tenantId: string, userId: string, yearKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await rowFor(tenantId, yearKey);
  if (!row?.draft) return { ok: false, error: "Load the worksheet first, then save it." };
  const now = new Date();
  await db.update(vatWorksheets).set({ data: row.draft, savedAt: now, savedBy: userId, draft: null, draftLoadedAt: null, draftLoadedBy: null }).where(eq(vatWorksheets.id, row.id));
  await logAuditEvent({
    tenantId,
    userId,
    action: "vat_worksheet.saved",
    entityType: "vat_worksheet",
    entityId: row.id,
    after: { fiscalYear: row.fiscalYearLabel, periods: row.draft.periods.length, openingCredit: row.draft.openingCredit },
  });
  return { ok: true };
}

/** Throws away a loaded draft, going back to the saved worksheet (or to nothing). */
export async function discardVatWorksheetDraft(tenantId: string, yearKey: string) {
  const row = await rowFor(tenantId, yearKey);
  if (!row?.draft) return;
  await db.update(vatWorksheets).set({ draft: null, draftLoadedAt: null, draftLoadedBy: null }).where(eq(vatWorksheets.id, row.id));
}
