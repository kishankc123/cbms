CREATE TYPE "public"."asset_source" AS ENUM('purchase', 'opening');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('draft', 'active', 'fully_depreciated', 'disposed', 'sold', 'written_off');--> statement-breakpoint
CREATE TABLE "asset_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2),
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"location_id" uuid,
	"status" "asset_status" DEFAULT 'active' NOT NULL,
	"source" "asset_source" NOT NULL,
	"purchase_date" date,
	"available_for_use_date" date,
	"vendor_id" uuid,
	"invoice_number" text,
	"purchase_order_number" text,
	"purchase_reference" text,
	"supporting_document" text,
	"purchase_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"freight_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"installation_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"capitalized_cost" numeric(18, 2) NOT NULL,
	"depreciation_method" "asset_depreciation_method" DEFAULT 'straight_line' NOT NULL,
	"useful_life_months" integer,
	"residual_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"depreciation_start_date" date,
	"depreciation_frequency" text DEFAULT 'monthly' NOT NULL,
	"opening_accumulated_depreciation" numeric(18, 2) DEFAULT '0' NOT NULL,
	"accumulated_depreciation" numeric(18, 2) DEFAULT '0' NOT NULL,
	"last_depreciation_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_asset_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."asset_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_events_asset" ON "asset_events" USING btree ("asset_id","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_tenant_code" ON "assets" USING btree ("tenant_id","asset_code");--> statement-breakpoint
CREATE INDEX "assets_tenant_status" ON "assets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "assets_tenant_category" ON "assets" USING btree ("tenant_id","category_id");