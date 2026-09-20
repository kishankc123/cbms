import { pgTable, uuid, text, boolean, pgEnum, uniqueIndex, AnyPgColumn } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

export const accountCategoryEnum = pgEnum("account_category", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

// Chart of Accounts — per tenant, hierarchical via parentAccountId.
export const accounts = pgTable(
  "accounts",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: accountCategoryEnum("category").notNull(),
  subCategory: text("sub_category"),
  parentAccountId: uuid("parent_account_id").references((): AnyPgColumn => accounts.id),
  isActive: boolean("is_active").notNull().default(true),
  },
  // An account code identifies one account in an organization; lookups by code depend on it.
  (t) => [uniqueIndex("accounts_tenant_code").on(t.tenantId, t.code)]
);

// Normal balance side per category — used to sign-correct balances for display.
export const NORMAL_BALANCE: Record<(typeof accountCategoryEnum.enumValues)[number], "debit" | "credit"> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
  expense: "debit",
};
