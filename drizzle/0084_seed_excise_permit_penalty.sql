-- Late renewal of the excise permit: bands of fines on the company's standard renewal fee. The figures were supplied by the
-- business and are not yet verified; a platform administrator can change them under Compliance Configuration > Fines and penalties.
INSERT INTO "compliance_penalty_rules" ("country_code", "tax_type_key", "effective_from", "params", "is_verified", "source")
SELECT 'NP', 'excise_permit', '2000-01-01', '{"tiers":[{"upToMonths":3,"rate":0.5,"action":"restricted"},{"upToMonths":6,"rate":1,"action":"severe"},{"upToMonths":null,"rate":2,"action":"cancelled"}]}'::jsonb, false, 'platform'
WHERE EXISTS (SELECT 1 FROM "compliance_countries" WHERE "code" = 'NP')
ON CONFLICT DO NOTHING;
