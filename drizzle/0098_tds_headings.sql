CREATE TABLE "compliance_tax_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"tax_type_key" text DEFAULT 'tds' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'rate' NOT NULL,
	"module" text DEFAULT 'expenses' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_tax_heads" ADD CONSTRAINT "compliance_tax_heads_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_tax_heads_country_type_key" ON "compliance_tax_heads" USING btree ("country_code","tax_type_key","key");
--> statement-breakpoint
INSERT INTO "compliance_tax_heads" ("country_code", "tax_type_key", "key", "name", "kind", "module", "sort_order")
SELECT c."code", 'tds', h."key", h."name", h."kind", h."module", h."sort"
FROM "compliance_countries" c,
  (VALUES ('payroll', 'Payroll', 'slabs', 'payroll', 0), ('rent', 'Rent', 'rate', 'expenses', 1), ('services', 'Services', 'rate', 'expenses', 2)) AS h("key", "name", "kind", "module", "sort")
WHERE c."code" = 'NP'
ON CONFLICT DO NOTHING;
