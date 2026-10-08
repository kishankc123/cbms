import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

// Every email the system tries to send, and whether it went. Only the facts are kept (who, what kind, the subject, the outcome):
// never the body or its links, which carry one-time tokens.
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The organization the email was about, when there is one (an invitation); null for account emails. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    /** "verification" | "password_reset" | "invitation" | "added_to_organization" | "other". */
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    /** "sent" | "failed" | "not_configured" (no email provider is set up, so the message was only printed on the server). */
    status: text("status").notNull(),
    /** Why it failed, as the provider or the network reported it. */
    error: text("error"),
    /** The provider's own id for the message, to look it up there. */
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_log_created").on(t.createdAt), index("email_log_to").on(t.toEmail, t.createdAt)]
);
