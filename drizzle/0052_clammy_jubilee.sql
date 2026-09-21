ALTER TABLE "inventory_settings" ADD COLUMN "opening_date" date;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "recost_of_id" uuid;