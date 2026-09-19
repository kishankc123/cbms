CREATE TYPE "public"."compliance_item_status" AS ENUM('upcoming', 'due', 'prepared', 'under_review', 'submitted', 'paid', 'completed', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."exception_severity" AS ENUM('information', 'warning', 'review_required', 'blocking');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('open', 'assigned', 'under_review', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('duplicate_invoice', 'duplicate_payment', 'missing_pan', 'missing_tax_info', 'missing_supporting_document', 'unreconciled_bank_transaction', 'negative_cash_balance', 'unapproved_transaction', 'backdated_transaction', 'closed_period_transaction', 'incorrect_tax_treatment', 'unusual_transaction_value', 'other');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'pending_close', 'closed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."rule_action" AS ENUM('warn', 'block', 'create_exception');--> statement-breakpoint
CREATE TYPE "public"."rule_check_type" AS ENUM('amount_threshold', 'missing_pan', 'duplicate_invoice', 'closed_period_posting', 'bank_unreconciled_days', 'negative_balance', 'backdated_transaction');--> statement-breakpoint
CREATE TYPE "public"."rule_module" AS ENUM('sales', 'purchases', 'expenses', 'payroll', 'bank_reconciliation', 'general');--> statement-breakpoint
CREATE TYPE "public"."rule_severity" AS ENUM('information', 'warning', 'review_required', 'blocking');--> statement-breakpoint
CREATE TABLE "accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"label" text NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_calendar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"applicable_company" text,
	"period" text NOT NULL,
	"due_date" date NOT NULL,
	"responsible_user_id" uuid,
	"amount" numeric(18, 2),
	"status" "compliance_item_status" DEFAULT 'upcoming' NOT NULL,
	"submission_date" date,
	"payment_date" date,
	"supporting_document" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transaction_type" text,
	"transaction_id" text,
	"exception_type" "exception_type" NOT NULL,
	"severity" "exception_severity" DEFAULT 'warning' NOT NULL,
	"description" text NOT NULL,
	"detected_date" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_user_id" uuid,
	"status" "exception_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"applicable_module" "rule_module" DEFAULT 'general' NOT NULL,
	"check_type" "rule_check_type" NOT NULL,
	"threshold_value" numeric(18, 2),
	"severity" "rule_severity" DEFAULT 'warning' NOT NULL,
	"action" "rule_action" DEFAULT 'warn' NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"effective_date" date,
	"expiry_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "pan_number" text;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_calendar_items" ADD CONSTRAINT "compliance_calendar_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_calendar_items" ADD CONSTRAINT "compliance_calendar_items_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exceptions" ADD CONSTRAINT "compliance_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exceptions" ADD CONSTRAINT "compliance_exceptions_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exceptions" ADD CONSTRAINT "compliance_exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;