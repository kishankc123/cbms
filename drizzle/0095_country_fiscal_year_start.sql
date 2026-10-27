ALTER TABLE "compliance_countries" ADD COLUMN "fiscal_year_start_month" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE "compliance_countries" SET "fiscal_year_start_month" = 4 WHERE "code" = 'NP';
