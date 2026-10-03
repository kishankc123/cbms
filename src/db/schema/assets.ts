import { pgTable, uuid, text, timestamp, boolean, integer, numeric, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

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
