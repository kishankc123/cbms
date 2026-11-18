CREATE TYPE "public"."incentive_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'one_off');--> statement-breakpoint
CREATE TYPE "public"."incentive_round_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "incentive_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incentive_headings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency" "incentive_frequency" DEFAULT 'monthly' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"counts_for_retirement" boolean DEFAULT false NOT NULL,
	"account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incentive_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"heading_id" uuid NOT NULL,
	"calendar_system" text DEFAULT 'AD' NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"period_label" text NOT NULL,
	"status" "incentive_round_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "incentives" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "incentives_detail" jsonb;--> statement-breakpoint
ALTER TABLE "incentive_entries" ADD CONSTRAINT "incentive_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_entries" ADD CONSTRAINT "incentive_entries_round_id_incentive_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."incentive_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_entries" ADD CONSTRAINT "incentive_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_headings" ADD CONSTRAINT "incentive_headings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_headings" ADD CONSTRAINT "incentive_headings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_rounds" ADD CONSTRAINT "incentive_rounds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_rounds" ADD CONSTRAINT "incentive_rounds_heading_id_incentive_headings_id_fk" FOREIGN KEY ("heading_id") REFERENCES "public"."incentive_headings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_rounds" ADD CONSTRAINT "incentive_rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_rounds" ADD CONSTRAINT "incentive_rounds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incentive_headings_tenant_name" ON "incentive_headings" USING btree ("tenant_id","name");