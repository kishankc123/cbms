import { pgTable, uuid, text, timestamp, date, numeric, boolean, integer, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";
import { accounts } from "./accounts";

// ============================================================================
// Compliance framework.
//
//   Country -> Entity type -> Applicable requirements -> Compliance records
//
// Two kinds of table live here, and the difference matters for multi-tenancy:
//
//  * CONFIGURATION (countries, entity types, tax types, authorities, categories,
//    requirement templates) is platform-owned and shared by every organization,
//    so these tables deliberately have NO tenant_id. Only platform admins may
//    change them (see src/lib/compliance/permissions.ts).
//  * RECORDS (obligations, account roles) belong to one organization and always
//    carry tenant_id, like every other tenant table.
//
// Nothing country-specific is hard-coded in code: Nepal is a configuration row.
// ============================================================================

export const complianceCountries = pgTable("compliance_countries", {
  /** ISO 3166-1 alpha-2, e.g. "NP". */
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  /**
   * The calendar this country's statutory periods are counted in ("BS" for
   * Nepal: VAT for Bhadra 2083 is due by a BS date whatever calendar the
   * organization displays). Templates may override with "org" / "AD" / "BS".
   */
  statutoryCalendar: text("statutory_calendar").notNull().default("AD"),
  isActive: boolean("is_active").notNull().default(true),
});

export const complianceEntityTypes = pgTable(
  "compliance_entity_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("compliance_entity_types_country_key").on(t.countryCode, t.key)]
);

export const complianceCategories = pgTable("compliance_categories", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const complianceAuthorities = pgTable(
  "compliance_authorities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("compliance_authorities_country_key").on(t.countryCode, t.key)]
);

export const complianceTaxTypes = pgTable(
  "compliance_tax_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    key: text("key").notNull(),
    name: text("name").notNull(),
    authorityKey: text("authority_key"),
    /** Whether an organization can hold a registration of this type (PAN, VAT, TDS, Excise...). */
    isRegistrable: boolean("is_registrable").notNull().default(false),
    /**
     * Ledger mapping. Each tax type that owes money gets a sub-account under the
     * organization's "Taxes Payable" group. `payableAccountName` names it when it
     * has to be created; `legacyPayableCode` points at an account that already
     * exists in older charts (2100 for VAT, 2320 for TDS) so it is reused, not
     * duplicated. Null = this tax type has no payable account.
     */
    /** "company_pan_vat": this registration's number IS the organization's PAN/VAT number (never stored twice). */
    numberSource: text("number_source"),
    /** Where "amount due" for this tax type is computed from ("vat_return", "tds_withheld"), or null if it is assessed/entered. */
    amountSource: text("amount_source"),
    payableAccountName: text("payable_account_name"),
    legacyPayableCode: text("legacy_payable_code"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("compliance_tax_types_country_key").on(t.countryCode, t.key)]
);

export const requirementFrequencyEnum = pgEnum("requirement_frequency", ["monthly", "quarterly", "annual", "one_time", "event_based"]);

export const complianceRequirementTemplates = pgTable(
  "compliance_requirement_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull().references(() => complianceCountries.code),
    /** null = applies to every entity type in the country. */
    entityTypeKey: text("entity_type_key"),
    categoryKey: text("category_key").notNull().references(() => complianceCategories.key),
    taxTypeKey: text("tax_type_key"),
    authorityKey: text("authority_key"),
    /** Stable identifier, e.g. "vat_return". Unique per country; never reused. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    frequency: requirementFrequencyEnum("frequency").notNull(),
    /** "statutory" (the country's calendar) | "org" (the organization's) | "AD" | "BS". */
    periodCalendar: text("period_calendar").notNull().default("statutory"),
    /**
     * Structured condition tree evaluated by the applicability engine
     * (src/lib/compliance/engine/applicability.ts) — not free text. null = always.
     */
    applicability: jsonb("applicability"),
    /** Structured due-date rule (engine/due-rules.ts). null for event-based requirements. */
    dueRule: jsonb("due_rule"),
    activeFrom: date("active_from"),
    activeTo: date("active_to"),
    isActive: boolean("is_active").notNull().default(true),
    /** Whether a compliance reviewer has confirmed the rule against current law. */
    isVerified: boolean("is_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("compliance_requirement_templates_country_key").on(t.countryCode, t.key)]
);

// ---------------------------------------------------------------- records

export const registrationStatusEnum = pgEnum("registration_status", ["active", "inactive", "suspended", "deregistered"]);

/**
 * Which taxes this organization is registered for. The PAN and VAT *numbers*
 * are the organization's single PAN/VAT number (tenants.pan_vat_number), so they
 * are never stored twice; registration_number here is for types that have their
 * own (TDS, Excise, ...). Status changes are kept in the audit log, so a
 * registration that lapses and returns leaves a history.
 */
export const tenantTaxRegistrations = pgTable(
  "tenant_tax_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taxTypeKey: text("tax_type_key").notNull(),
    registrationNumber: text("registration_number"),
    registrationDate: date("registration_date"),
    effectiveDate: date("effective_date"),
    deregistrationDate: date("deregistration_date"),
    status: registrationStatusEnum("status").notNull().default("active"),
    authorityKey: text("authority_key"),
    /** Reference only for now (document storage is not finalised). */
    supportingDocument: text("supporting_document"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenant_tax_registrations_tenant_type").on(t.tenantId, t.taxTypeKey)]
);

export const assessmentKindEnum = pgEnum("assessment_kind", ["assessment", "penalty", "interest"]);
export const assessmentStatusEnum = pgEnum("assessment_status", ["posted", "voided"]);

/**
 * A tax authority's assessment, penalty or interest charge recorded against a tax
 * type (optionally against one obligation). Recording one posts a journal entry:
 *   Dr expense (fines & penalties, ...)   Cr the tax type's payable account.
 * Voiding reverses that entry; the row is kept.
 */
export const complianceTaxAssessments = pgTable("compliance_tax_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  obligationId: uuid("obligation_id"),
  taxTypeKey: text("tax_type_key").notNull(),
  kind: assessmentKindEnum("kind").notNull(),
  assessmentDate: date("assessment_date").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: text("description"),
  referenceNumber: text("reference_number"),
  expenseAccountId: uuid("expense_account_id").notNull().references(() => accounts.id),
  payableAccountId: uuid("payable_account_id").notNull().references(() => accounts.id),
  journalEntryId: uuid("journal_entry_id"),
  status: assessmentStatusEnum("status").notNull().default("posted"),
  voidReason: text("void_reason"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
});

export const obligationStatusEnum = pgEnum("obligation_status", ["pending", "in_progress", "filed", "paid", "partially_paid", "not_applicable"]);
export const obligationSourceEnum = pgEnum("obligation_source", ["generated", "manual", "migrated"]);

/**
 * One thing an organization has to do by a date (a VAT return for Bhadra 2083,
 * the FY 2082/83 income tax return, ...). Generated from requirement templates
 * or entered by hand.
 *
 * "Overdue" is NOT a stored status: it is derived (due date passed and not
 * done), so it can never go stale. A requirement that does not apply is marked
 * `not_applicable` with a reason — rows are never deleted to hide them.
 */
export const complianceObligations = pgTable(
  "compliance_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => complianceRequirementTemplates.id),
    source: obligationSourceEnum("source").notNull().default("manual"),
    name: text("name").notNull(),
    categoryKey: text("category_key").notNull().references(() => complianceCategories.key),
    taxTypeKey: text("tax_type_key"),
    /** How often the requirement recurs (from its template; null for hand-entered items = one-time). */
    frequency: requirementFrequencyEnum("frequency"),
    /**
     * Identity of the period within its template, e.g. "M:BS:2083-06" (a BS month)
     * or "FY:2025-07-17" (a fiscal year, by its real AD start). With the template
     * it makes generation idempotent: the same period is never created twice.
     */
    periodKey: text("period_key"),
    /** Human label captured when the item was created ("Bhadra 2083"). */
    periodLabel: text("period_label").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    /** Real AD date, computed once when generated — later rule edits don't move filed items. */
    dueDate: date("due_date").notNull(),
    status: obligationStatusEnum("status").notNull().default("pending"),
    notApplicableReason: text("not_applicable_reason"),
    filingDate: date("filing_date"),
    paymentDueDate: date("payment_due_date"),
    paymentDate: date("payment_date"),
    /** Amount due, where entered/assessed. Amount paid is derived from linked payments, not stored here. */
    amountDue: numeric("amount_due", { precision: 18, scale: 2 }),
    filingReference: text("filing_reference"),
    paymentReference: text("payment_reference"),
    /** Reference only for now (document storage is not finalised). */
    supportingDocument: text("supporting_document"),
    notes: text("notes"),
    responsibleUserId: uuid("responsible_user_id").references(() => users.id),
    /** The old compliance_calendar_items row this was migrated from — makes migration re-runnable. */
    legacyItemId: uuid("legacy_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("compliance_obligations_template_period").on(t.tenantId, t.templateId, t.periodKey),
    uniqueIndex("compliance_obligations_legacy_item").on(t.legacyItemId),
  ]
);

/**
 * Maps a business role ("tax_payable:vat", "tax_payable_group") to whichever
 * account this organization uses for it. Code that needs "the VAT payable
 * account" asks for the role, so charts of accounts can be customised — and the
 * account changed later — without touching code that looks accounts up by code.
 */
export const accountRoles = pgTable(
  "account_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("account_roles_tenant_role").on(t.tenantId, t.roleKey)]
);

// ============================================================================
// Ownership & capital.
//
// Split of truth: paid-up capital and each shareholder's paid amount live in the
// LEDGER (an equity sub-account per shareholder under the share capital group).
// Everything the ledger cannot know — authorised capital, the number of shares
// issued, face value, who holds how many shares — lives here. Every change to
// either is an appended row in capital_changes; nothing is overwritten silently.
// ============================================================================

/** One row per organization: the capital structure as it stands today. */
export const tenantCapital = pgTable("tenant_capital", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  authorisedCapital: numeric("authorised_capital", { precision: 18, scale: 2 }).notNull().default("0"),
  /** Total shares issued. Issued capital = issued shares x face value (derived, never stored twice). */
  issuedShares: integer("issued_shares").notNull().default(0),
  faceValue: numeric("face_value", { precision: 18, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("NPR"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareholderStatusEnum = pgEnum("shareholder_status", ["active", "inactive"]);

export const shareholders = pgTable("shareholders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** individual | company | other */
  holderType: text("holder_type").notNull().default("individual"),
  shareClass: text("share_class").notNull().default("Ordinary"),
  sharesHeld: integer("shares_held").notNull().default(0),
  dateAcquired: date("date_acquired"),
  status: shareholderStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  /** This shareholder's own capital sub-account in the ledger — their paid amount is its balance. */
  capitalAccountId: uuid("capital_account_id").references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const capitalChangeTypeEnum = pgEnum("capital_change_type", [
  "initial_setup",
  "authorised_capital_increase",
  "shares_issued",
  "paid_up_capital_increase",
  "share_transfer",
  "share_cancellation",
  "face_value_change",
  "capital_assignment",
  "shareholder_added",
  "shareholder_deactivated",
  "other",
]);

/**
 * The capital and shareholding history. APPEND-ONLY: rows are only ever inserted
 * (there is no update or delete path), so a previous value is never lost.
 */
export const capitalChanges = pgTable("capital_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  changeType: capitalChangeTypeEnum("change_type").notNull(),
  effectiveDate: date("effective_date").notNull(),
  shareholderId: uuid("shareholder_id").references(() => shareholders.id),
  /** The receiving shareholder of a transfer. */
  toShareholderId: uuid("to_shareholder_id").references(() => shareholders.id),
  shares: integer("shares"),
  /** Money moved in the ledger by this change, if any. */
  amount: numeric("amount", { precision: 18, scale: 2 }),
  previousValue: numeric("previous_value", { precision: 18, scale: 2 }),
  newValue: numeric("new_value", { precision: 18, scale: 2 }),
  reason: text("reason"),
  referenceNumber: text("reference_number"),
  /** Reference only for now (document storage is not finalised). */
  supportingDocument: text("supporting_document"),
  notes: text("notes"),
  journalEntryId: uuid("journal_entry_id"),
  paymentId: uuid("payment_id"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLagatStatusEnum = pgEnum("share_lagat_status", ["updated", "update_required"]);

/**
 * Share Lagat history, append-only. The current state is the latest entry.
 * "update_required" entries are created automatically when shares change;
 * "updated" entries are recorded by a person, with date, reference and notes.
 */
export const shareLagatEntries = pgTable("share_lagat_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  status: shareLagatStatusEnum("status").notNull(),
  lastUpdatedDate: date("last_updated_date"),
  lastChangeDate: date("last_change_date"),
  reason: text("reason"),
  referenceNumber: text("reference_number"),
  supportingDocument: text("supporting_document"),
  notes: text("notes"),
  isAutomatic: boolean("is_automatic").notNull().default(false),
  capitalChangeId: uuid("capital_change_id"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
