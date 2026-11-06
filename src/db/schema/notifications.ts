import { pgTable, uuid, text, date, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";

// One person's choice about one KIND of notification in one organization (the bell itself is worked out live from the books, so only this is kept).
// "seen" greys it out and takes it off the badge; "snoozed" hides it until \`snoozedUntil\`. \`countAt\` is how many things were behind it when the choice
// was made, so the notification returns by itself if more arrive.
export const notificationStates = pgTable(
  "notification_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** "seen" | "snoozed" */
    state: text("state").notNull(),
    snoozedUntil: date("snoozed_until"),
    countAt: integer("count_at"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notification_states_tenant_user_key").on(t.tenantId, t.userId, t.key)]
);
