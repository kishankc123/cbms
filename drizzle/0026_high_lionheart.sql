DROP TABLE "payments" CASCADE;--> statement-breakpoint
DROP TABLE "receipts" CASCADE;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_number_mode" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_number_format" text DEFAULT 'prefix-number-suffix' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_prefix" text DEFAULT 'PAY-';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_suffix" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "receipt_prefix" text DEFAULT 'REC-';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "receipt_suffix" text;