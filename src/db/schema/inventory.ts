import { pgTable, uuid, text, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

export const itemUnits = pgTable("item_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const itemGroups = pgTable("item_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

// Categories are always created under a Group.
export const itemCategories = pgTable("item_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  groupId: uuid("group_id")
    .notNull()
    .references(() => itemGroups.id),
  name: text("name").notNull(),
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  unitId: uuid("unit_id").references(() => itemUnits.id),
  categoryId: uuid("category_id").references(() => itemCategories.id),
  purchasePrice: numeric("purchase_price", { precision: 18, scale: 2 }).notNull().default("0"),
  sellingPrice: numeric("selling_price", { precision: 18, scale: 2 }).notNull().default("0"),
  // Running on-hand quantity, kept in sync by Stockable purchases (+) and
  // sales of stockable items (-) — the source for future inventory reports.
  stockQuantity: numeric("stock_quantity", { precision: 18, scale: 3 }).notNull().default("0"),
});
