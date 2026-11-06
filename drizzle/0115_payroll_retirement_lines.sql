ALTER TABLE "payroll_lines" ADD COLUMN "employee_retirement" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "employer_retirement" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "retirement_detail" jsonb;