ALTER TYPE "public"."payment_type" ADD VALUE 'staff_advance' BEFORE 'expense_payment';--> statement-breakpoint
CREATE TABLE "staff_advance_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"advance_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"advance_date" date NOT NULL,
	"for_calendar" text DEFAULT 'AD' NOT NULL,
	"for_month" integer NOT NULL,
	"for_year" integer NOT NULL,
	"for_period_start" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "advance_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "advance_recovered" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_advance_recoveries" ADD CONSTRAINT "staff_advance_recoveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advance_recoveries" ADD CONSTRAINT "staff_advance_recoveries_advance_id_staff_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."staff_advances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advance_recoveries" ADD CONSTRAINT "staff_advance_recoveries_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_payment_id_payments_ledger_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_advance_recoveries_run" ON "staff_advance_recoveries" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_advances_payment" ON "staff_advances" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "staff_advances_employee" ON "staff_advances" USING btree ("tenant_id","employee_id");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_advance_account_id_accounts_id_fk" FOREIGN KEY ("advance_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;