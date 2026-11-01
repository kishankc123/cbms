CREATE TABLE "compliance_module_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"module_key" text NOT NULL,
	"tax_type_key" text NOT NULL,
	"method" text NOT NULL,
	"bearer" text NOT NULL,
	"price_basis" text NOT NULL,
	"posts_to" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_module_taxes" ADD CONSTRAINT "compliance_module_taxes_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_module_taxes" ADD CONSTRAINT "compliance_module_taxes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_module_taxes_country_module_tax" ON "compliance_module_taxes" USING btree ("country_code","module_key","tax_type_key");
--> statement-breakpoint
-- Nepal starts with the taxes applied the way the modules already work today, so nothing changes until an administrator edits a row.
INSERT INTO "compliance_module_taxes" ("country_code", "module_key", "tax_type_key", "method", "bearer", "price_basis", "posts_to")
SELECT c."code", v."module_key", v."tax_type_key", v."method", v."bearer", v."price_basis", v."posts_to"
FROM "compliance_countries" c
CROSS JOIN (VALUES
  ('sales', 'vat', 'flat', 'collected', 'inclusive', 'output_vat'),
  ('purchases', 'vat', 'flat', 'claimable', 'inclusive', 'input_vat'),
  ('expenses', 'vat', 'flat', 'claimable', 'inclusive', 'input_vat'),
  ('expenses', 'tds', 'heading', 'withheld', 'on_amount', 'tds_payable'),
  ('payroll', 'tds', 'slab', 'withheld', 'on_amount', 'tds_payable'),
  ('assets', 'vat', 'flat', 'claimable', 'inclusive', 'input_vat'),
  ('returns', 'vat', 'flat', 'reverses', 'inclusive', 'tax_payable')
) AS v("module_key", "tax_type_key", "method", "bearer", "price_basis", "posts_to")
WHERE c."code" = 'NP'
ON CONFLICT DO NOTHING;
