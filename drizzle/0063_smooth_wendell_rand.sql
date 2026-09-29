CREATE TYPE "public"."recurring_expense_due_rule" AS ENUM('same_day', 'specific_day_same_month', 'specific_day_following_month', 'days_after_recognition');--> statement-breakpoint
CREATE TYPE "public"."recurring_expense_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_expense_priority" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."recurring_expense_recognition_rule" AS ENUM('first_day', 'last_day', 'specific_day');--> statement-breakpoint
CREATE TYPE "public"."recurring_expense_status" AS ENUM('active', 'paused', 'stopped');--> statement-breakpoint
CREATE TABLE "recurring_expense_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recurring_expense_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_label" text NOT NULL,
	"expense_date" date NOT NULL,
	"due_date" date,
	"expected_amount" numeric(18, 2) NOT NULL,
	"expense_id" uuid,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_name" text NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"vendor_id" uuid,
	"payee_name" text,
	"amount" numeric(18, 2) NOT NULL,
	"frequency" "recurring_expense_frequency" NOT NULL,
	"interval_months" integer DEFAULT 1 NOT NULL,
	"recognition_rule" "recurring_expense_recognition_rule" DEFAULT 'last_day' NOT NULL,
	"recognition_day" integer,
	"due_rule" "recurring_expense_due_rule" DEFAULT 'specific_day_following_month' NOT NULL,
	"due_rule_value" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"effective_from" date NOT NULL,
	"priority" "recurring_expense_priority" DEFAULT 'normal' NOT NULL,
	"expected_payment_account_id" uuid,
	"notes" text,
	"status" "recurring_expense_status" DEFAULT 'active' NOT NULL,
	"paused_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stopped_effective_date" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_expense_instances" ADD CONSTRAINT "recurring_expense_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_instances" ADD CONSTRAINT "recurring_expense_instances_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_instances" ADD CONSTRAINT "recurring_expense_instances_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_expected_payment_account_id_accounts_id_fk" FOREIGN KEY ("expected_payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_expense_instances_period" ON "recurring_expense_instances" USING btree ("recurring_expense_id","period_key");