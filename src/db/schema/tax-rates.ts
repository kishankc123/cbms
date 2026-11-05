import { pgTable, uuid, text, numeric, date, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { complianceCountries } from "./compliance-framework";

// A tax rate that applied for a stretch of time. Rates are never edited in place: changing one closes the
// currently-open row (effectiveTo = the day before) and opens a new row from the new effective date. A
// transaction — including one entered later but dated in the past — always finds the rate that was actually in
// force on ITS date, never whatever the rate happens to be today.
//
// Every row belongs to one organization (tenantId), even a "platform" one — a future admin publishing a rate
// change for a country fans it out to one row per organization in that country, rather than living in a second,
// parallel table. That keeps exactly one lookup path (this table, by tenant + date) whichever way a rate arrived,
// so publishing centrally later is an additive change: a new writer, not a new reader.
export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taxTypeKey: text("tax_type_key").notNull(), // "vat" | "tds"
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    /** null = still in force. */
    effectiveTo: date("effective_to"),
    /**
     * Who set this rate: "manual" (an organization changed it themselves — everything today) or "platform" (a
     * platform administrator published it for the country; not built yet, but the column exists so that when it
     * is, the UI can tell the two apart — e.g. show read-only "published by your administrator" instead of a
     * "Change rate" button, with no migration needed to add the distinction after the fact).
     */
    source: text("source").notNull().default("manual"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tax_rates_tenant_type_from").on(t.tenantId, t.taxTypeKey, t.effectiveFrom)]
);

// The rates a platform administrator publishes for a whole country: one timeline per country and tax type. Publishing a rate
// also writes it into every organization of that country (a tax_rates row with source "platform"), and an organization created
// later starts from these versions, so every organization is on the same rates from the same dates.
export const platformTaxRates = pgTable(
  "platform_tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    taxTypeKey: text("tax_type_key").notNull(), // "vat" | "tds"
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    /** null = still in force. Closed the day before the next version starts. */
    effectiveTo: date("effective_to"),
    /** Whether a compliance reviewer has confirmed the rate against current law. */
    isVerified: boolean("is_verified").notNull().default(false),
    /** Where the rate comes from (a Finance Act, a notice), for the record. */
    source: text("source"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_tax_rates_country_type_from").on(t.countryCode, t.taxTypeKey, t.effectiveFrom)]
);

// Next fiscal year's rates, carried forward from the version in force and waiting for an administrator to edit and confirm them. A draft
// changes nothing: until it is confirmed (which publishes it as a normal version), the rate that was in force keeps applying.
export const platformTaxRateDrafts = pgTable(
  "platform_tax_rate_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    taxTypeKey: text("tax_type_key").notNull(),
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
    /** The first day of the fiscal year the draft is for. */
    effectiveFrom: date("effective_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_tax_rate_drafts_country_type_from").on(t.countryCode, t.taxTypeKey, t.effectiveFrom)]
);

// Slab tables (salary TDS): like a rate, published for a whole country in numbered versions, but a version is a set of income slabs per
// taxpayer class instead of one percentage. `tables` is { single: [{ upTo, rate }], couple: [...] }, the last slab open-ended (upTo null).
// Organizations do not get a copy: payroll reads the version in force on the pay date and records which one it used.
export const platformSlabVersions = pgTable(
  "platform_slab_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    /** The TDS heading these slabs belong to (a heading of kind "slabs", for example "payroll"). */
    headKey: text("head_key").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    tables: jsonb("tables").notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    source: text("source"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_slab_versions_country_head_from").on(t.countryCode, t.headKey, t.effectiveFrom)]
);

// Next fiscal year's slabs, carried forward and waiting to be edited and confirmed. Changes nothing until confirmed.
export const platformSlabDrafts = pgTable(
  "platform_slab_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    headKey: text("head_key").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    tables: jsonb("tables").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_slab_drafts_country_head_from").on(t.countryCode, t.headKey, t.effectiveFrom)]
);

// Payroll rules (retirement schemes, the limit on retirement savings that reduce tax, the first-band exemption) published for a whole
// country in dated versions, like slabs. `rules` is one document (see PayrollRules). Organizations read the version in force on the pay
// date; finalized payroll keeps what it used, so a new version never changes a past run.
export const platformPayrollRuleVersions = pgTable(
  "platform_payroll_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    rules: jsonb("rules").notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    /** The Act, notice or rule the figures come from. */
    source: text("source"),
    /** null for versions seeded by a migration. */
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_payroll_rules_country_from").on(t.countryCode, t.effectiveFrom)]
);
