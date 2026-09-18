CREATE TYPE "public"."purchase_type" AS ENUM('cash', 'credit');--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD COLUMN "purchase_type" "purchase_type" DEFAULT 'credit' NOT NULL;