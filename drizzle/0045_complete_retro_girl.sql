ALTER TABLE "purchase_bills" ADD COLUMN "bill_available" boolean;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "bill_type" "bill_type" DEFAULT 'no_bill' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "bill_available" boolean;