import { pgTable, uuid, text, date, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";

export const fiscalYearStatusEnum = pgEnum("fiscal_year_status", ["open", "closed", "reopened"]);
export type FiscalYearStatus = (typeof fiscalYearStatusEnum.enumValues)[number];

// One row per fiscal year, per tenant — the persistent history that a single
// mutable start/end date pair on `tenants` can't provide (see tenants.fiscalYearStartDate's
// comment: that field is the org's CURRENT fiscal year only, overwritten on rollover, with
// no memory of prior years' boundaries). Dates are always AD, matching the rest of the app —
// BS boundaries are derived on demand via the existing calendar engine (bsFiscalYearOf /
// convertADtoBS), never stored separately, so there is only one calendar conversion engine.
export const fiscalYears = pgTable(
  "fiscal_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    // Nepali BS label, e.g. "2083/84" — for a non-BS org this is a plain AD year like "2026".
    code: text("code").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: fiscalYearStatusEnum("status").notNull().default("open"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedBy: uuid("reopened_by").references(() => users.id),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fiscal_years_tenant_code").on(t.tenantId, t.code)]
);
