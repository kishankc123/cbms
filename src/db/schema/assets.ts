import { pgTable, uuid, text, timestamp, boolean, integer, numeric, date, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./tenancy";
import { vendors, purchaseBills } from "./purchases";
import { customers } from "./sales";

// Fixed assets. Everything here is country-neutral: an asset's ACCOUNTING classification (its category) is kept apart
// from any country's TAX classification, which lives in its own tables and never in these.

export const assetDepreciationMethodEnum = pgEnum("asset_depreciation_method", ["straight_line", "declining_balance", "none"]);

/** One row per organization: asset code numbering and the default depreciation frequency. */
export const assetSettings = pgTable("asset_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  codePrefix: text("code_prefix").notNull().default("FA-"),
  autoGenerateCode: boolean("auto_generate_code").notNull().default(true),
  // Monthly today; the column is text so quarterly/yearly can be added without a migration.
  depreciationFrequency: text("depreciation_frequency").notNull().default("monthly"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Accounting asset categories (Land, Building, Vehicle ...). They only carry DEFAULTS for a new asset's depreciation —
 * every asset can override them — and are deliberately not tied to any tax rate.
 */
export const assetCategories = pgTable(
  "asset_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultMethod: assetDepreciationMethodEnum("default_method").notNull().default("straight_line"),
    /** Whole years; null when the category isn't depreciated (Land). */
    defaultUsefulLifeYears: integer("default_useful_life_years"),
    /** Residual value as a percentage of cost (0-100). */
    defaultResidualPercent: numeric("default_residual_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_categories_tenant_name").on(t.tenantId, t.name), index("asset_categories_tenant").on(t.tenantId)]
);

/** Physical places an asset can be (a plain list: no departments or cost centres). */
export const assetLocations = pgTable(
  "asset_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_locations_tenant_name").on(t.tenantId, t.name)]
);

export const assetStatusEnum = pgEnum("asset_status", ["draft", "active", "fully_depreciated", "disposed", "sold", "written_off", "voided"]);
export const assetSourceEnum = pgEnum("asset_source", ["purchase", "opening"]);

/**
 * One fixed asset: the single record that follows it from purchase (or from the opening balances) to disposal.
 * Net book value is never stored — it is capitalizedCost minus accumulatedDepreciation. accumulatedDepreciation IS
 * stored as a running total (updated in the same transaction as each depreciation posting), so the register and its
 * summary never have to add up a schedule, and it can be reconciled against the ledger.
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    assetCode: text("asset_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").notNull().references(() => assetCategories.id),
    locationId: uuid("location_id").references(() => assetLocations.id),
    status: assetStatusEnum("status").notNull().default("active"),
    source: assetSourceEnum("source").notNull(),

    // Purchase. Bought date and available-for-use date are separate on purpose; depreciation normally starts from the latter.
    purchaseDate: date("purchase_date"),
    availableForUseDate: date("available_for_use_date"),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    /** The supplier bill an asset purchase created; null for opening assets. */
    purchaseBillId: uuid("purchase_bill_id").references(() => purchaseBills.id),
    invoiceNumber: text("invoice_number"),
    purchaseOrderNumber: text("purchase_order_number"),
    purchaseReference: text("purchase_reference"),
    supportingDocument: text("supporting_document"),

    // Cost. capitalizedCost = price + non-recoverable tax + freight + installation + other directly attributable costs
    // (recoverable input VAT is not part of it). For an opening asset it is the original cost.
    purchasePrice: numeric("purchase_price", { precision: 18, scale: 2 }).notNull().default("0"),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    freightCost: numeric("freight_cost", { precision: 18, scale: 2 }).notNull().default("0"),
    installationCost: numeric("installation_cost", { precision: 18, scale: 2 }).notNull().default("0"),
    otherCost: numeric("other_cost", { precision: 18, scale: 2 }).notNull().default("0"),
    capitalizedCost: numeric("capitalized_cost", { precision: 18, scale: 2 }).notNull(),

    // Accounting depreciation (a country's tax depreciation is kept apart, in its own tables).
    depreciationMethod: assetDepreciationMethodEnum("depreciation_method").notNull().default("straight_line"),
    /** Months still to be depreciated from depreciationStartDate. For a purchase this is the full useful life. */
    usefulLifeMonths: integer("useful_life_months"),
    /** Opening assets only: the useful life the asset started with, kept for reference (usefulLifeMonths is what is left). */
    originalUsefulLifeMonths: integer("original_useful_life_months"),
    residualValue: numeric("residual_value", { precision: 18, scale: 2 }).notNull().default("0"),
    depreciationStartDate: date("depreciation_start_date"),
    depreciationFrequency: text("depreciation_frequency").notNull().default("monthly"),
    /** Depreciation already taken before the books started (opening assets); part of accumulatedDepreciation. */
    openingAccumulatedDepreciation: numeric("opening_accumulated_depreciation", { precision: 18, scale: 2 }).notNull().default("0"),
    accumulatedDepreciation: numeric("accumulated_depreciation", { precision: 18, scale: 2 }).notNull().default("0"),
    lastDepreciationDate: date("last_depreciation_date"),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assets_tenant_code").on(t.tenantId, t.assetCode),
    index("assets_tenant_status").on(t.tenantId, t.status),
    index("assets_tenant_category").on(t.tenantId, t.categoryId),
  ]
);

/** The asset's own timeline (purchased, available for use, depreciation posted, transferred, disposed ...). Written by each action. */
export const assetEvents = pgTable(
  "asset_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventDate: date("event_date").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }),
    /** The ledger entry this event posted, so the asset can be traced to the General Ledger. */
    journalEntryId: uuid("journal_entry_id"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_events_asset").on(t.assetId, t.eventDate)]
);

/** One monthly depreciation run: a single ledger entry covering every asset depreciated in it. Only the latest posted run can be reversed. */
export const assetDepreciationRuns = pgTable(
  "asset_depreciation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    runNumber: integer("run_number").notNull(),
    /** The month the run depreciates up to (assets behind on earlier months catch up in the same run). */
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    periodLabel: text("period_label").notNull(),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
    assetCount: integer("asset_count").notNull(),
    journalEntryId: uuid("journal_entry_id"),
    status: text("status").notNull().default("posted"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("asset_dep_runs_tenant_number").on(t.tenantId, t.runNumber),
    // One posted run per month; a reversed run frees its month again.
    uniqueIndex("asset_dep_runs_tenant_period_posted").on(t.tenantId, t.periodEnd).where(sql`${t.status} = 'posted'`),
  ]
);

/** What each asset was depreciated by in a run (the per-asset schedule behind the single ledger entry). */
export const assetDepreciationLines = pgTable(
  "asset_depreciation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => assetDepreciationRuns.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    /** How many months of depreciation this line covers (more than one when the asset is catching up). */
    months: integer("months").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    accumulatedAfter: numeric("accumulated_after", { precision: 18, scale: 2 }).notNull(),
  },
  (t) => [index("asset_dep_lines_run").on(t.runId), index("asset_dep_lines_asset").on(t.assetId)]
);

/** A sale, disposal or write-off of an asset: what left the books, what came in, and the gain or loss. Reversible while its period is open. */
export const assetDisposals = pgTable(
  "asset_disposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    /** sale | disposal | write_off */
    kind: text("kind").notNull(),
    reference: text("reference").notNull(),
    disposalDate: date("disposal_date").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    /** The buyer's or our own invoice number for a sale. */
    invoiceNumber: text("invoice_number"),
    /** taxable | none (sales only). */
    taxTreatment: text("tax_treatment").notNull().default("none"),
    saleAmount: numeric("sale_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    receivedAccountId: uuid("received_account_id"),
    cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
    accumulatedDepreciation: numeric("accumulated_depreciation", { precision: 18, scale: 2 }).notNull(),
    netBookValue: numeric("net_book_value", { precision: 18, scale: 2 }).notNull(),
    /** Proceeds less net book value: positive is a gain, negative a loss. */
    gainLoss: numeric("gain_loss", { precision: 18, scale: 2 }).notNull(),
    reason: text("reason"),
    journalEntryId: uuid("journal_entry_id"),
    status: text("status").notNull().default("posted"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("asset_disposals_tenant_reference").on(t.tenantId, t.reference), index("asset_disposals_asset").on(t.assetId), index("asset_disposals_tenant_date").on(t.tenantId, t.disposalDate)]
);
