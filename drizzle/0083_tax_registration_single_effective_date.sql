-- A registration now has one date, "Effective from". Where only the old registration date was filled in, keep it as the effective date.
UPDATE "tenant_tax_registrations" SET "effective_date" = "registration_date" WHERE "effective_date" IS NULL AND "registration_date" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_tax_registrations" DROP COLUMN "registration_date";