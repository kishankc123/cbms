import { pgTable, uuid, text, boolean, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";
import { accounts } from "./accounts";

// How money is received or paid (Cash, Cheque, Bank transfer, Fonepay, Card, Wallet, ...), per organization. A mode is
// linked to the lowest-level accounts of the Chart of Accounts that hold that kind of money; transactions still store the
// account, so the ledger and every report are unchanged.
export const paymentModes = pgTable(
  "payment_modes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_modes_tenant_name").on(t.tenantId, sql`lower(${t.name})`)]
);

// Which accounts belong to which mode. One account can serve several modes (a bank takes cheques, transfers, Fonepay and cards).
export const paymentModeAccounts = pgTable(
  "payment_mode_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    modeId: uuid("mode_id").notNull().references(() => paymentModes.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
  },
  (t) => [uniqueIndex("payment_mode_accounts_mode_account").on(t.modeId, t.accountId), index("payment_mode_accounts_account").on(t.accountId)]
);
