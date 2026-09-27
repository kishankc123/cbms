import { pgTable, uuid, text, numeric, boolean, date, timestamp, uniqueIndex, index, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";

// Item Type is classification (what the business calls it) — it is deliberately NOT what decides inventory
// behavior. That is inventoryTracking, below, kept as its own independent flag: a "Product" can be untracked
// (a digital download), and nothing outside this table should ever infer tracking from type.
export const itemTypeEnum = pgEnum("item_type", ["product", "service", "saas", "other"]);

// How an item CAN be billed — independent of itemType too: a Service can be recurring (a monthly retainer), a
// SaaS item can be one-time (a lifetime license). Nothing should assume "SaaS therefore subscription". Only
// classification for now — one_time is the only kind that actually generates anything today; recurring/
// subscription/usage_based are stored so Subscriptions and Recurring Invoices can be built without another
// migration, per the "design the data model to support it later" principle already used for inventoryTracking.
export const billingTypeEnum = pgEnum("billing_type", ["one_time", "recurring", "subscription", "usage_based"]);

// Names are unique within the organization, whatever the capitalization.
export const itemUnits = pgTable("item_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("item_units_tenant_name").on(t.tenantId, sql`lower(${t.name})`)]);

export const itemGroups = pgTable("item_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("item_groups_tenant_name").on(t.tenantId, sql`lower(${t.name})`)]);

// Categories are always created under a Group; a name is unique within its group.
export const itemCategories = pgTable("item_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  groupId: uuid("group_id")
    .notNull()
    .references(() => itemGroups.id),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("item_categories_group_name").on(t.tenantId, t.groupId, sql`lower(${t.name})`)]);

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  itemType: itemTypeEnum("item_type").notNull().default("product"),
  // Independent of itemType (see the enum's comment above). Only a tracked item ever moves stock, carries a cost,
  // or affects COGS/Inventory accounting — the engine checks this, never the type. Fixed the same way itemType
  // is once the item has real history (see updateItem): flipping it on an item with stock movements or postings
  // would quietly change how its past is accounted for.
  inventoryTracking: boolean("inventory_tracking").notNull().default(false),
  // Classification only — see the enum's comment above. Free to change later; unlike itemType/inventoryTracking
  // it doesn't yet drive any posting or inventory behavior, so an existing item's history is never at risk.
  billingType: billingTypeEnum("billing_type").notNull().default("one_time"),
  // Null = use the tenant's default Sales Revenue account (today's only behavior, and every existing item's).
  // Once a sale posts, the journal line already carries whatever account was resolved at that moment — the
  // journal itself is the historical record, so changing this later can never rewrite a past invoice's posting.
  revenueAccountId: uuid("revenue_account_id").references(() => accounts.id),
  unitId: uuid("unit_id").references(() => itemUnits.id),
  categoryId: uuid("category_id").references(() => itemCategories.id),
  // The item's standard prices: what new purchase / sales lines start with. They are NOT the cost of stock — the cost is
  // tracked in stockValue below (a purchase price is only used as the cost of units sold beyond what is on hand).
  purchasePrice: numeric("purchase_price", { precision: 18, scale: 2 }).notNull().default("0"),
  sellingPrice: numeric("selling_price", { precision: 18, scale: 2 }).notNull().default("0"),
  // Running on-hand quantity and the cost of it (weighted average: stockValue / stockQuantity is the cost per unit), both
  // kept in step by stock movements. The stock value of all items is what the Inventory account should hold.
  stockQuantity: numeric("stock_quantity", { precision: 18, scale: 3 }).notNull().default("0"),
  stockValue: numeric("stock_value", { precision: 18, scale: 2 }).notNull().default("0"),
  // An inactive item is kept for history but no longer offered on new sales, purchases and returns.
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [uniqueIndex("items_tenant_name").on(t.tenantId, sql`lower(${t.name})`)]);

// Every change to an item's stock, append-only — the stock card. A quantity/value is signed (+ in, - out). Undoing something
// (a void, an edit) adds the opposite movement pointing back at the one it cancels, so history is never rewritten.
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id),
  movementDate: date("movement_date").notNull(),
  // opening | purchase | purchase_return | sale | sales_return | adjustment | recost
  type: text("type").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
  value: numeric("value", { precision: 18, scale: 2 }).notNull(),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  reversalOfId: uuid("reversal_of_id"),
  // A "recost" movement (quantity 0, only a value) that corrects the cost of an earlier movement after history changed.
  recostOfId: uuid("recost_of_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("stock_movements_item").on(t.tenantId, t.itemId, t.movementDate), index("stock_movements_source").on(t.tenantId, t.sourceType, t.sourceId)]);

export const inventorySettings = pgTable("inventory_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id, { onDelete: "cascade" }),
  // When off (the default), a sale that would take an item below zero is refused.
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  // When inventory history begins. Opening stock belongs to this date, and no stock movement may be dated before it. Empty = not set yet.
  openingDate: date("opening_date"),
});
