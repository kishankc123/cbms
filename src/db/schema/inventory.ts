import { pgTable, uuid, text, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  unit: text("unit"),
  defaultRate: numeric("default_rate", { precision: 18, scale: 2 }).notNull().default("0"),
});
