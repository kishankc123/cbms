import { pgTable, uuid, text, timestamp, date, integer, numeric, index } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { vendors } from "./purchases";

// How the cash forecast is set up for an organization. One row at most; the defaults apply until one is saved.
export const planningSettings = pgTable("planning_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id, { onDelete: "cascade" }),
  // The cash to keep in hand, as months of fixed expenses (payroll, rent and the like).
  reserveMonths: integer("reserve_months").notNull().default(3),
  // A fixed amount for the reserve instead of months of fixed expenses. Empty = use the months.
  reserveOverride: numeric("reserve_override", { precision: 18, scale: 2 }),
  // How many days after an invoice customers are expected to pay when there is no due date and no history. Empty = learned from the last 6 months, else 30.
  defaultCollectionDays: integer("default_collection_days"),
});

/**
 * Spending, or a change in sales, the owner is planning. A plan only: it posts nothing and approves nothing, and it is tried against
 * the cash forecast to show what it would do. Its values (category, pattern, urgency, sales effect, status) are kept as text and
 * checked where they are saved, so a new choice never needs a migration.
 */
export const plannedEvents = pgTable(
  "planned_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    /** The best guess, with the range around it. */
    estimate: numeric("estimate", { precision: 18, scale: 2 }).notNull(),
    low: numeric("low", { precision: 18, scale: 2 }),
    high: numeric("high", { precision: 18, scale: 2 }),
    /** The window the spending can happen in, and the day chosen inside it. */
    earliestDate: date("earliest_date").notNull(),
    latestDate: date("latest_date"),
    plannedDate: date("planned_date").notNull(),
    pattern: text("pattern").notNull().default("full"),
    advancePct: integer("advance_pct"),
    balanceDays: integer("balance_days"),
    instalments: integer("instalments"),
    intervalDays: integer("interval_days"),
    creditDays: integer("credit_days"),
    urgency: text("urgency").notNull().default("should_do_soon"),
    salesEffect: text("sales_effect").notNull().default("none"),
    /** Cash a month that sales would gain or lose, and for how many days. */
    salesEffectMonthly: numeric("sales_effect_monthly", { precision: 18, scale: 2 }),
    salesEffectDays: integer("sales_effect_days"),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("planned_events_tenant_status").on(t.tenantId, t.status, t.plannedDate)]
);
