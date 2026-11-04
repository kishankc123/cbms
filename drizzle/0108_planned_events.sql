CREATE TABLE "planned_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"vendor_id" uuid,
	"estimate" numeric(18, 2) NOT NULL,
	"low" numeric(18, 2),
	"high" numeric(18, 2),
	"earliest_date" date NOT NULL,
	"latest_date" date,
	"planned_date" date NOT NULL,
	"pattern" text DEFAULT 'full' NOT NULL,
	"advance_pct" integer,
	"balance_days" integer,
	"instalments" integer,
	"interval_days" integer,
	"credit_days" integer,
	"urgency" text DEFAULT 'should_do_soon' NOT NULL,
	"sales_effect" text DEFAULT 'none' NOT NULL,
	"sales_effect_monthly" numeric(18, 2),
	"sales_effect_days" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_events_tenant_status" ON "planned_events" USING btree ("tenant_id","status","planned_date");