CREATE TABLE "tax_depreciation_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pool_key" text NOT NULL,
	"asset_id" uuid,
	"label" text NOT NULL,
	"result" jsonb NOT NULL,
	"closing_wdv" numeric(18, 2) NOT NULL,
	"total_deduction" numeric(18, 2) NOT NULL,
	"balancing_charge" numeric(18, 2) NOT NULL,
	"terminal_deduction" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_depreciation_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"status" text DEFAULT 'final' NOT NULL,
	"rules_version_id" uuid,
	"rules" jsonb NOT NULL,
	"rules_verified" boolean DEFAULT false NOT NULL,
	"legal_reference" text NOT NULL,
	"total_deduction" numeric(18, 2) NOT NULL,
	"balancing_charge" numeric(18, 2) NOT NULL,
	"terminal_deduction" numeric(18, 2) NOT NULL,
	"finalised_by" uuid,
	"finalised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tax_depreciation_pools" ADD CONSTRAINT "tax_depreciation_pools_year_id_tax_depreciation_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."tax_depreciation_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_depreciation_pools" ADD CONSTRAINT "tax_depreciation_pools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_depreciation_pools" ADD CONSTRAINT "tax_depreciation_pools_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_depreciation_years" ADD CONSTRAINT "tax_depreciation_years_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_depreciation_years" ADD CONSTRAINT "tax_depreciation_years_rules_version_id_platform_tax_depreciation_rule_versions_id_fk" FOREIGN KEY ("rules_version_id") REFERENCES "public"."platform_tax_depreciation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_depreciation_years" ADD CONSTRAINT "tax_depreciation_years_finalised_by_users_id_fk" FOREIGN KEY ("finalised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_depreciation_years" ADD CONSTRAINT "tax_depreciation_years_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_dep_pools_year" ON "tax_depreciation_pools" USING btree ("year_id");--> statement-breakpoint
CREATE INDEX "tax_dep_pools_tenant" ON "tax_depreciation_pools" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_dep_years_tenant_year_final" ON "tax_depreciation_years" USING btree ("tenant_id","tax_year") WHERE "tax_depreciation_years"."status" = 'final';--> statement-breakpoint
CREATE INDEX "tax_dep_years_tenant" ON "tax_depreciation_years" USING btree ("tenant_id","tax_year");