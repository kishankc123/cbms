ALTER TABLE "compliance_tax_types" ADD COLUMN "number_source" text;--> statement-breakpoint
UPDATE "compliance_tax_types" SET "number_source" = 'company_pan_vat' WHERE "country_code" = 'NP' AND "key" IN ('pan', 'vat');
