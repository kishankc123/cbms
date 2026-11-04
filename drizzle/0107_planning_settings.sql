CREATE TABLE "planning_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reserve_months" integer DEFAULT 3 NOT NULL,
	"reserve_override" numeric(18, 2),
	"default_collection_days" integer,
	CONSTRAINT "planning_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "planning_settings" ADD CONSTRAINT "planning_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;