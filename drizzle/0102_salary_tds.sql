ALTER TABLE "employees" ADD COLUMN "tax_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "prior_income" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "prior_tds" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "taxable_pay" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "tds_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "tds_detail" jsonb;