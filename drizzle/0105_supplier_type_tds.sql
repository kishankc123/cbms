ALTER TABLE "vendors" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "compliance_tax_heads" ADD COLUMN "by_payee_type" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "compliance_tax_heads" SET "name" = 'Salary and benefits' WHERE "country_code" = 'NP' AND "tax_type_key" = 'tds' AND "key" = 'payroll' AND "name" = 'Payroll';--> statement-breakpoint
UPDATE "compliance_tax_heads" SET "name" = 'Services and professional fees', "by_payee_type" = true WHERE "country_code" = 'NP' AND "tax_type_key" = 'tds' AND "key" = 'services';
