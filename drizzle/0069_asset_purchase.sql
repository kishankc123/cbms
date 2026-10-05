ALTER TYPE "public"."journal_source_type" ADD VALUE 'asset_purchase' BEFORE 'asset_depreciation';--> statement-breakpoint
ALTER TYPE "public"."purchase_type" ADD VALUE 'asset';--> statement-breakpoint
ALTER TYPE "public"."asset_status" ADD VALUE 'voided';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "purchase_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchase_bill_id_purchase_bills_id_fk" FOREIGN KEY ("purchase_bill_id") REFERENCES "public"."purchase_bills"("id") ON DELETE no action ON UPDATE no action;