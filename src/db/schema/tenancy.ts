import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  date,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended", "cancelled"]);
// Role a user holds *within one organization* (see memberships) — never
// global. "super_admin" (platform owner) is deliberately not here: it is a
// separate flag on the user, not an organization role.
export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "accountant", "staff"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "suspended"]);
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);
export const authTokenTypeEnum = pgEnum("auth_token_type", ["email_verification", "password_reset"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trial", "active", "past_due", "cancelled"]);
export const userStatusEnum = pgEnum("user_status", ["active", "invited", "disabled"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Human-readable support reference (CL-000001) — auto-generated, never
  // used for login or as a foreign key; the uuid id is the real identifier.
  clientCode: text("client_code").unique(),
  companyName: text("company_name").notNull(),
  industry: text("industry"),
  country: text("country"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  vatRegistrationNumber: text("vat_registration_number"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  // Nepali (Bikram Sambat) fiscal year, e.g. "2081/82", plus the AD calendar
  // dates it corresponds to — kept separate from fiscalYearStartMonth above,
  // which is unused now that the Settings page collects these instead.
  fiscalYearLabel: text("fiscal_year_label"),
  fiscalYearStartDate: date("fiscal_year_start_date"),
  fiscalYearEndDate: date("fiscal_year_end_date"),
  baseCurrency: text("base_currency").notNull().default("NPR"),
  taxRegistrationNumber: text("tax_registration_number"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("13"),
  // Default TDS (Tax Deducted at Source) withholding rate applied to
  // expenses — configurable per tenant, never hard-coded in the UI.
  tdsRate: numeric("tds_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  invoicePrefix: text("invoice_prefix"),
  invoiceSuffix: text("invoice_suffix"),
  // One of the INVOICE_NUMBER_FORMATS keys in src/lib/invoice-number.ts, e.g.
  // "prefix-number-suffix" — controls the order the three parts are joined in.
  invoiceNumberFormat: text("invoice_number_format").notNull().default("prefix-number-suffix"),
  // Payment module numbering — "single" uses one PAY- sequence for both
  // directions, "split" uses a separate REC-/PAY- sequence per direction.
  paymentNumberMode: text("payment_number_mode").notNull().default("single"),
  paymentNumberFormat: text("payment_number_format").notNull().default("prefix-number-suffix"),
  paymentPrefix: text("payment_prefix").default("PAY"),
  paymentSuffix: text("payment_suffix"),
  receiptPrefix: text("receipt_prefix").default("REC"),
  receiptSuffix: text("receipt_suffix"),
  status: tenantStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Permissions = Record<
  string,
  { view: boolean; create: boolean; edit: boolean; delete: boolean }
>;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // A person, independent of any organization — which organizations they can
  // enter, and their role in each, live in `memberships`.
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  mobile: text("mobile"),
  // Platform (software owner) administrator — separate from any organization
  // role and not tied to a tenant.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Bumped on password change/reset so every existing session is rejected.
  sessionVersion: integer("session_version").notNull().default(0),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null for platform-level actions (e.g. super admin creating a tenant)
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

// USER <-> ORGANIZATION (many-to-many). The role and permissions a person has
// are decided here, per organization — the same user can be Owner of one
// business and Staff in another.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull(),
    // Optional per-member override of the role's default permissions.
    permissions: jsonb("permissions").$type<Permissions>(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_user_tenant_idx").on(t.userId, t.tenantId)]
);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: orgRoleEnum("role").notNull(),
  // Only a SHA-256 hash of the emailed token is stored.
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  status: invitationStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Email verification and password reset tokens (hash only).
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: authTokenTypeEnum("type").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Billing/plan state lives apart from the organization so plans can change
// without touching the organization's identity or status.
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("trial"),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
