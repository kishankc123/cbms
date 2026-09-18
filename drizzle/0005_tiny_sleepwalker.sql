ALTER TABLE "tenants" ADD COLUMN "invoice_prefix" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_suffix" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_number_format" text DEFAULT 'prefix-number-suffix' NOT NULL;