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
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["super_admin", "admin", "user"]);
export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended"]);
export const userStatusEnum = pgEnum("user_status", ["active", "invited", "disabled"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: text("company_name").notNull(),
  industry: text("industry"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  // Nepali (Bikram Sambat) fiscal year, e.g. "2081/82", plus the AD calendar
  // dates it corresponds to — kept separate from fiscalYearStartMonth above,
  // which is unused now that the Settings page collects these instead.
  fiscalYearLabel: text("fiscal_year_label"),
  fiscalYearStartDate: date("fiscal_year_start_date"),
  fiscalYearEndDate: date("fiscal_year_end_date"),
  baseCurrency: text("base_currency").notNull().default("NPR"),
  taxRegistrationNumber: text("tax_registration_number"),
  status: tenantStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Permissions = Record<
  string,
  { view: boolean; create: boolean; edit: boolean; delete: boolean }
>;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null only for super_admin, who is platform-wide and not scoped to a tenant
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull(),
  permissions: jsonb("permissions").$type<Permissions>().notNull().default({}),
  status: userStatusEnum("status").notNull().default("active"),
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
