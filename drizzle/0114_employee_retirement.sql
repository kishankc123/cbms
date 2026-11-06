CREATE TABLE "employee_retirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"registration_number" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"cit_mode" text,
	"cit_value" numeric(18, 2),
	"cit_employer_value" numeric(18, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "tax_residency" text DEFAULT 'resident' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "sst_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_retirement" ADD CONSTRAINT "employee_retirement_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_retirement" ADD CONSTRAINT "employee_retirement_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_retirement" ADD CONSTRAINT "employee_retirement_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;