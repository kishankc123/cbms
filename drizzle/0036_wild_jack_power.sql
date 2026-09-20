ALTER TYPE "public"."journal_source_type" ADD VALUE 'tax_assessment';--> statement-breakpoint
ALTER TABLE "compliance_tax_types" ADD COLUMN "amount_source" text;--> statement-breakpoint
UPDATE "compliance_tax_types" SET "amount_source" = 'vat_return' WHERE "country_code" = 'NP' AND "key" = 'vat';--> statement-breakpoint
UPDATE "compliance_tax_types" SET "amount_source" = 'tds_withheld' WHERE "country_code" = 'NP' AND "key" = 'tds';
