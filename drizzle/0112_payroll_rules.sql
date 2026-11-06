CREATE TABLE "platform_payroll_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"rules" jsonb NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_payroll_rule_versions" ADD CONSTRAINT "platform_payroll_rule_versions_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payroll_rule_versions" ADD CONSTRAINT "platform_payroll_rule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_payroll_rules_country_from" ON "platform_payroll_rule_versions" USING btree ("country_code","effective_from");--> statement-breakpoint
INSERT INTO "platform_payroll_rule_versions" ("country_code", "effective_from", "rules", "is_verified", "source")
SELECT 'NP', '2026-07-17', '{"schemes":{"ssf":{"label":"Social Security Fund","basis":"basic","lines":[{"key":"provident_fund","label":"Provident fund","employeePct":10,"employerPct":10},{"key":"gratuity","label":"Gratuity","employeePct":0,"employerPct":8.33},{"key":"other","label":"Other SSF components","employeePct":1,"employerPct":1.67}],"monthlyBasisCap":null,"eligibleEmploymentTypes":null,"sstExemptionPossible":true},"pf":{"label":"Provident fund","basis":"basic","lines":[{"key":"provident_fund","label":"Provident fund","employeePct":10,"employerPct":10}],"monthlyBasisCap":null,"eligibleEmploymentTypes":null,"sstExemptionPossible":false}},"cit":{"employerContributionAllowed":true,"monthlyCeiling":null},"retirementDeduction":{"incomeShare":{"num":1,"den":3},"annualCap":500000},"sst":{"exemptBands":1}}'::jsonb, false, 'Initial values from the payroll specification for FY 2083/84. Not yet checked against the Finance Act, Income Tax Act or SSF rules.'
WHERE EXISTS (SELECT 1 FROM "compliance_countries" WHERE "code" = 'NP');
