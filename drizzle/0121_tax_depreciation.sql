CREATE TABLE "asset_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"pool_key_override" text,
	"entered_class_date" date,
	"cost_incurred_date" date,
	"period_of_use_years" numeric(6, 1),
	"period_basis" text,
	"concession_key" text,
	"concession_confirmed" boolean DEFAULT false NOT NULL,
	"concession_documentation" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_tax_depreciation_rule_versions" (
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
CREATE TABLE "tax_category_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"pool_key" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_deferred_additions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid,
	"asset_label" text NOT NULL,
	"pool_key" text NOT NULL,
	"original_tax_year" integer NOT NULL,
	"original_date" date NOT NULL,
	"original_cost" numeric(18, 2) NOT NULL,
	"original_thirds" integer NOT NULL,
	"included_in_original_year" numeric(18, 2) NOT NULL,
	"remaining_deferred" numeric(18, 2) NOT NULL,
	"due_tax_year" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"included_in_tax_year" integer,
	"source" text DEFAULT 'opening' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_pool_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"pool_key" text NOT NULL,
	"asset_id" uuid,
	"opening_wdv" numeric(18, 2) NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_statutory_additions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"pool_key" text NOT NULL,
	"type_key" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"legal_reference" text NOT NULL,
	"evidence" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_tax_profiles" ADD CONSTRAINT "asset_tax_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tax_profiles" ADD CONSTRAINT "asset_tax_profiles_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_tax_depreciation_rule_versions" ADD CONSTRAINT "platform_tax_depreciation_rule_versions_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_tax_depreciation_rule_versions" ADD CONSTRAINT "platform_tax_depreciation_rule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_category_map" ADD CONSTRAINT "tax_category_map_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_category_map" ADD CONSTRAINT "tax_category_map_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_category_map" ADD CONSTRAINT "tax_category_map_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deferred_additions" ADD CONSTRAINT "tax_deferred_additions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deferred_additions" ADD CONSTRAINT "tax_deferred_additions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deferred_additions" ADD CONSTRAINT "tax_deferred_additions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_pool_openings" ADD CONSTRAINT "tax_pool_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_pool_openings" ADD CONSTRAINT "tax_pool_openings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_pool_openings" ADD CONSTRAINT "tax_pool_openings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statutory_additions" ADD CONSTRAINT "tax_statutory_additions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statutory_additions" ADD CONSTRAINT "tax_statutory_additions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tax_profiles_asset" ON "asset_tax_profiles" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_tax_profiles_tenant" ON "asset_tax_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_taxdep_rules_country_from" ON "platform_tax_depreciation_rule_versions" USING btree ("country_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_category_map_tenant_category" ON "tax_category_map" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "tax_deferred_tenant_due" ON "tax_deferred_additions" USING btree ("tenant_id","due_tax_year","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_deferred_asset_year" ON "tax_deferred_additions" USING btree ("tenant_id","asset_id","original_tax_year","original_date") WHERE "tax_deferred_additions"."asset_id" is not null and "tax_deferred_additions"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "tax_pool_openings_pooled" ON "tax_pool_openings" USING btree ("tenant_id","tax_year","pool_key") WHERE "tax_pool_openings"."asset_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_pool_openings_individual" ON "tax_pool_openings" USING btree ("tenant_id","tax_year","pool_key","asset_id") WHERE "tax_pool_openings"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "tax_statutory_tenant_year" ON "tax_statutory_additions" USING btree ("tenant_id","tax_year");
--> statement-breakpoint
INSERT INTO "platform_tax_depreciation_rule_versions" ("country_code", "effective_from", "rules", "is_verified", "source") VALUES ('NP', '2018-07-17', '{"legalReference":"Income Tax Act 2058, Schedule 2","taxYearStartMonth":4,"pools":[{"key":"A","label":"Class A: buildings and permanent structures","kind":"pooled","ratePercent":5,"writeOffBelow":2000},{"key":"B","label":"Class B: computers, furniture and office equipment","kind":"pooled","ratePercent":25,"writeOffBelow":2000},{"key":"C","label":"Class C: automobiles, buses and minibuses","kind":"pooled","ratePercent":20,"writeOffBelow":2000},{"key":"D","label":"Class D: construction, excavation and other tangible assets","kind":"pooled","ratePercent":15,"writeOffBelow":2000},{"key":"E","label":"Class E: intangible assets (each its own class)","kind":"individual","ratePercent":null,"writeOffBelow":null}],"timing":[{"fromMonth":4,"toMonth":9,"thirds":3},{"fromMonth":10,"toMonth":12,"thirds":2},{"fromMonth":1,"toMonth":3,"thirds":1}],"statutoryAdditions":[{"key":"repair_excess","label":"Excess repair and maintenance expenditure","legalReference":"Income Tax Act 2058, Section 16(3)","requiresEvidence":true},{"key":"pollution_control","label":"Capitalised pollution-control expenditure","legalReference":"Income Tax Act 2058, Section 17(3)","requiresEvidence":true},{"key":"research_development","label":"Capitalised research and development expenditure","legalReference":"Income Tax Act 2058, Section 18(3)","requiresEvidence":true},{"key":"other_authorised","label":"Other specifically authorised statutory addition","legalReference":"","requiresEvidence":true}],"concessions":[{"key":"extra_third_rate","label":"Additional one-third depreciation rate","legalReference":"Income Tax Act 2058, Schedule 2, Section 3(2)","kind":"extra_rate","extraRateFraction":0.3333333333333333},{"key":"energy_generation_half","label":"50% same-year deduction: energy-generation property used in the business","legalReference":"Income Tax Act 2058, Schedule 2","kind":"same_year","sameYearPercent":50},{"key":"fiscal_printer_full","label":"Same-year deduction: fiscal printers and cash machines issuing bills","legalReference":"Income Tax Act 2058, Schedule 2","kind":"same_year","sameYearPercent":100}]}'::jsonb, false, 'Income Tax Act 2058, Schedule 2 (loaded as unverified; confirm against the current Finance Act)');
