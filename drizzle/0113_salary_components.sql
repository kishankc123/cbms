CREATE TABLE "employee_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"amount" numeric(18, 2),
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN "calc_type" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN "counts_for_retirement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN "recurrence" text DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_components" ADD COLUMN "auto_assign" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "components_detail" jsonb;--> statement-breakpoint
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_component_id_payroll_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."payroll_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Until now every component applied to every employee. Keep it that way for existing organizations: the components are given to everyone
-- automatically from now on, and each current employee is assigned every component from their joining date, so pay does not change.
UPDATE "payroll_components" SET "auto_assign" = true;
--> statement-breakpoint
INSERT INTO "employee_components" ("tenant_id", "employee_id", "component_id", "effective_from")
SELECT e."tenant_id", e."id", c."id", e."joining_date" FROM "employees" e JOIN "payroll_components" c ON c."tenant_id" = e."tenant_id";
