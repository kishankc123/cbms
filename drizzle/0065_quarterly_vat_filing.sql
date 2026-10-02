-- Quarterly VAT filing (Nepal): the monthly VAT return now applies only to monthly filers, a quarterly
-- return template is added for quarterly filers, and the VAT penalty rule gains the flat quarterly non-filer fine.
-- Config sync is insert-only, so rows that already exist are brought up to date here.
UPDATE "compliance_requirement_templates"
SET "applicability" = '{"all":[{"fact":"registered_tax_types","op":"includes","value":"vat"},{"fact":"vat_filing_frequency","op":"neq","value":"quarterly"}]}'::jsonb
WHERE "country_code" = 'NP' AND "key" = 'vat_return';--> statement-breakpoint
INSERT INTO "compliance_requirement_templates" ("country_code", "category_key", "tax_type_key", "authority_key", "key", "name", "description", "frequency", "period_calendar", "applicability", "due_rule", "is_active", "is_verified")
SELECT 'NP', 'tax', 'vat', 'ird', 'vat_return_quarterly', 'VAT Return (Quarterly)',
  'Quarterly VAT return. Terms: Shrawan–Kartik (T1), Mangsir–Falgun (T2), Chaitra–Ashad (T3). Due by the 25th of the first month after the term ends (BS).',
  'quarterly', 'statutory',
  '{"all":[{"fact":"registered_tax_types","op":"includes","value":"vat"},{"fact":"vat_filing_frequency","op":"eq","value":"quarterly"}]}'::jsonb,
  '{"period":"term","monthsAfterEnd":1,"dayOfMonth":25}'::jsonb, true, false
WHERE EXISTS (SELECT 1 FROM "compliance_countries" WHERE "code" = 'NP')
ON CONFLICT ("country_code", "key") DO NOTHING;--> statement-breakpoint
UPDATE "compliance_penalty_rules"
SET "params" = "params" || '{"quarterlyFilingFine":1000}'::jsonb
WHERE "country_code" = 'NP' AND "tax_type_key" = 'vat' AND NOT ("params" ? 'quarterlyFilingFine');
