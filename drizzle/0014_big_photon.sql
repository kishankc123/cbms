ALTER TABLE "items" ADD COLUMN "purchase_price" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "selling_price" numeric(18, 2) DEFAULT '0' NOT NULL;