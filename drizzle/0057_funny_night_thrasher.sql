CREATE TYPE "public"."item_type" AS ENUM('product', 'service', 'saas', 'other');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_type" "item_type" DEFAULT 'product' NOT NULL;