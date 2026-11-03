import { pgTable, uuid, integer, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

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
