import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";

/** The sales and purchase figures of one VAT period, as worked out from the books when the worksheet was loaded. */
export type VatWorksheetPeriodFigures = {
  obligationId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  netSales: number;
  salesVat: number;
  netPurchase: number;
  purchaseVat: number;
};

/** What a load freezes: the year's period figures, the receivable brought in from earlier years, and what earlier years left payable. */
export type VatWorksheetFigures = {
  openingCredit: number;
  periods: VatWorksheetPeriodFigures[];
  /** Earlier periods that were left with VAT payable after netting, by obligation (what was paid against them stays live). */
  earlierPayable: { obligationId: string; netPayable: number }[];
};

// One saved VAT worksheet per organization per fiscal year. Loading works the figures out from the books (slow) and keeps them
// as a draft; saving makes the draft the saved worksheet. Later changes to sales or purchases do not touch a saved worksheet:
// the person loads again and saves again. Payments and filing status are not frozen — they are read live when the sheet is shown.
export const vatWorksheets = pgTable(
  "vat_worksheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Start date (AD) of the fiscal year. */
    fiscalYearKey: text("fiscal_year_key").notNull(),
    fiscalYearLabel: text("fiscal_year_label").notNull(),
    data: jsonb("data").$type<VatWorksheetFigures>(),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    savedBy: uuid("saved_by").references(() => users.id),
    draft: jsonb("draft").$type<VatWorksheetFigures>(),
    draftLoadedAt: timestamp("draft_loaded_at", { withTimezone: true }),
    draftLoadedBy: uuid("draft_loaded_by").references(() => users.id),
  },
  (t) => [uniqueIndex("vat_worksheets_tenant_year").on(t.tenantId, t.fiscalYearKey)]
);
