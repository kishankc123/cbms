import { pgTable, uuid, text, timestamp, boolean, integer, numeric, date, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./tenancy";
import { complianceCountries } from "./compliance-framework";
import { assets, assetCategories } from "./assets";

// Tax depreciation is its own layer. Nothing here is read by the ledger, the books' depreciation or the profit and loss statement.

/** A country's tax depreciation rules (classes, rates, timing, statutory additions, concessions) in dated versions published by a platform administrator. */
export const platformTaxDepreciationRuleVersions = pgTable(
  "platform_tax_depreciation_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    rules: jsonb("rules").notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    source: text("source"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_taxdep_rules_country_from").on(t.countryCode, t.effectiveFrom)]
);

/** Which tax class each accounting category normally belongs to. poolKey null = no depreciation class (Land). */
export const taxCategoryMap = pgTable(
  "tax_category_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull().references(() => assetCategories.id, { onDelete: "cascade" }),
    poolKey: text("pool_key"),
    /** The default could not be sure of this category's class: someone has to confirm it. */
    needsReview: boolean("needs_review").notNull().default(false),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tax_category_map_tenant_category").on(t.tenantId, t.categoryId)]
);

/** One asset's tax details: its class if it differs from its category's, the dates that place it, and (for intangibles) the period of use. */
export const assetTaxProfiles = pgTable(
  "asset_tax_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    /** null = follow the category's class. */
    poolKeyOverride: text("pool_key_override"),
    /** The day the asset entered the tax class (put into business use); null = use the available-for-use date. */
    enteredClassDate: date("entered_class_date"),
    costIncurredDate: date("cost_incurred_date"),
    /** Intangible assets: years the asset is expected to be used, and the basis (contract, licence, law). */
    periodOfUseYears: numeric("period_of_use_years", { precision: 6, scale: 1 }),
    periodBasis: text("period_basis"),
    /** A same-year concession this asset qualifies for (a key in the rules), with the eligibility confirmed and the paperwork named. */
    concessionKey: text("concession_key"),
    concessionConfirmed: boolean("concession_confirmed").notNull().default(false),
    concessionDocumentation: text("concession_documentation"),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewNote: text("review_note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_tax_profiles_asset").on(t.assetId), index("asset_tax_profiles_tenant").on(t.tenantId)]
);

/** Balances brought forward into a tax year: one row per class, or per intangible asset for an individual class. */
export const taxPoolOpenings = pgTable(
  "tax_pool_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** The tax year's starting Bikram Sambat year (2082 = 2082/83). */
    taxYear: integer("tax_year").notNull(),
    poolKey: text("pool_key").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    /** Written-down value carried in from the end of the previous tax year. */
    openingWdv: numeric("opening_wdv", { precision: 18, scale: 2 }).notNull(),
    note: text("note"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tax_pool_openings_pooled").on(t.tenantId, t.taxYear, t.poolKey).where(sql`${t.assetId} is null`),
    uniqueIndex("tax_pool_openings_individual").on(t.tenantId, t.taxYear, t.poolKey, t.assetId).where(sql`${t.assetId} is not null`),
  ]
);

/** The deferred-addition register: the part of an addition that was held back by the timing rule and joins a later year's pool. */
export const taxDeferredAdditions = pgTable(
  "tax_deferred_additions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    /** What the addition was, for entries whose asset isn't in the register. */
    assetLabel: text("asset_label").notNull(),
    poolKey: text("pool_key").notNull(),
    originalTaxYear: integer("original_tax_year").notNull(),
    originalDate: date("original_date").notNull(),
    originalCost: numeric("original_cost", { precision: 18, scale: 2 }).notNull(),
    /** How many thirds were let into the original year's pool. */
    originalThirds: integer("original_thirds").notNull(),
    includedInOriginalYear: numeric("included_in_original_year", { precision: 18, scale: 2 }).notNull(),
    remainingDeferred: numeric("remaining_deferred", { precision: 18, scale: 2 }).notNull(),
    dueTaxYear: integer("due_tax_year").notNull(),
    /** pending | included (joined a pool) | settled (dissolution settled it) | cancelled */
    status: text("status").notNull().default("pending"),
    includedInTaxYear: integer("included_in_tax_year"),
    /** opening (entered by hand at go-live) | calculated (made by a tax year's calculation) */
    source: text("source").notNull().default("opening"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tax_deferred_tenant_due").on(t.tenantId, t.dueTaxYear, t.status),
    // The same asset's addition in the same year can be in the register once.
    uniqueIndex("tax_deferred_asset_year").on(t.tenantId, t.assetId, t.originalTaxYear, t.originalDate).where(sql`${t.assetId} is not null and ${t.status} <> 'cancelled'`),
  ]
);

/** Statutory additions (repair excess, pollution control, research and development, other authorised) that add to a class for a tax year. */
export const taxStatutoryAdditions = pgTable(
  "tax_statutory_additions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taxYear: integer("tax_year").notNull(),
    poolKey: text("pool_key").notNull(),
    typeKey: text("type_key").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    legalReference: text("legal_reference").notNull(),
    evidence: text("evidence").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tax_statutory_tenant_year").on(t.tenantId, t.taxYear)]
);

/**
 * A tax year's finalised calculation. It keeps the rules it was calculated with (and which published version they were), so a later change to the
 * law never alters it. Reopening marks it "reopened" instead of deleting it: earlier calculations are preserved.
 */
export const taxDepreciationYears = pgTable(
  "tax_depreciation_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taxYear: integer("tax_year").notNull(),
    /** final | reopened */
    status: text("status").notNull().default("final"),
    rulesVersionId: uuid("rules_version_id").references(() => platformTaxDepreciationRuleVersions.id),
    rules: jsonb("rules").notNull(),
    rulesVerified: boolean("rules_verified").notNull().default(false),
    legalReference: text("legal_reference").notNull(),
    totalDeduction: numeric("total_deduction", { precision: 18, scale: 2 }).notNull(),
    balancingCharge: numeric("balancing_charge", { precision: 18, scale: 2 }).notNull(),
    terminalDeduction: numeric("terminal_deduction", { precision: 18, scale: 2 }).notNull(),
    finalisedBy: uuid("finalised_by").references(() => users.id),
    finalisedAt: timestamp("finalised_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedBy: uuid("reopened_by").references(() => users.id),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
  },
  (t) => [uniqueIndex("tax_dep_years_tenant_year_final").on(t.tenantId, t.taxYear).where(sql`${t.status} = 'final'`), index("tax_dep_years_tenant").on(t.tenantId, t.taxYear)]
);

/** One class's result in a finalised year (or one intangible asset's), exactly as calculated. */
export const taxDepreciationPools = pgTable(
  "tax_depreciation_pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    yearId: uuid("year_id").notNull().references(() => taxDepreciationYears.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    poolKey: text("pool_key").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    result: jsonb("result").notNull(),
    closingWdv: numeric("closing_wdv", { precision: 18, scale: 2 }).notNull(),
    totalDeduction: numeric("total_deduction", { precision: 18, scale: 2 }).notNull(),
    balancingCharge: numeric("balancing_charge", { precision: 18, scale: 2 }).notNull(),
    terminalDeduction: numeric("terminal_deduction", { precision: 18, scale: 2 }).notNull(),
  },
  (t) => [index("tax_dep_pools_year").on(t.yearId), index("tax_dep_pools_tenant").on(t.tenantId)]
);
