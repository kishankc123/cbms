CREATE TABLE "inventory_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	CONSTRAINT "inventory_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_date" date NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"reversal_of_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_value" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_item" ON "stock_movements" USING btree ("tenant_id","item_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_source" ON "stock_movements" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_group_name" ON "item_categories" USING btree ("tenant_id","group_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_groups_tenant_name" ON "item_groups" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_units_tenant_name" ON "item_units" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "items_tenant_name" ON "items" USING btree ("tenant_id",lower("name"));