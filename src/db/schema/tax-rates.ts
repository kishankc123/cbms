import { pgTable, uuid, text, numeric, date, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
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
