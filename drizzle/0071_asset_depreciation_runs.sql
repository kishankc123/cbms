CREATE TABLE "asset_depreciation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"accumulated_after" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"period_label" text NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"asset_count" integer NOT NULL,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_run_id_asset_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."asset_depreciation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_dep_lines_run" ON "asset_depreciation_lines" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "asset_dep_lines_asset" ON "asset_depreciation_lines" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_dep_runs_tenant_number" ON "asset_depreciation_runs" USING btree ("tenant_id","run_number");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_dep_runs_tenant_period_posted" ON "asset_depreciation_runs" USING btree ("tenant_id","period_end") WHERE "asset_depreciation_runs"."status" = 'posted';