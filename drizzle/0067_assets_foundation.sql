CREATE TYPE "public"."asset_depreciation_method" AS ENUM('straight_line', 'declining_balance', 'none');--> statement-breakpoint
ALTER TYPE "public"."journal_source_type" ADD VALUE 'asset_depreciation';--> statement-breakpoint
ALTER TYPE "public"."journal_source_type" ADD VALUE 'asset_disposal';--> statement-breakpoint
ALTER TYPE "public"."journal_source_type" ADD VALUE 'asset_writeoff';--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_method" "asset_depreciation_method" DEFAULT 'straight_line' NOT NULL,
	"default_useful_life_years" integer,
	"default_residual_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code_prefix" text DEFAULT 'FA-' NOT NULL,
	"auto_generate_code" boolean DEFAULT true NOT NULL,
	"depreciation_frequency" text DEFAULT 'monthly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_settings" ADD CONSTRAINT "asset_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_tenant_name" ON "asset_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "asset_categories_tenant" ON "asset_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_locations_tenant_name" ON "asset_locations" USING btree ("tenant_id","name");