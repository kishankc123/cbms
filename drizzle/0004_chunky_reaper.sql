ALTER TABLE "tenants" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '13' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "gross_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL;