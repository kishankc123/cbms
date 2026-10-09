CREATE TABLE "vat_worksheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_year_key" text NOT NULL,
	"fiscal_year_label" text NOT NULL,
	"data" jsonb,
	"saved_at" timestamp with time zone,
	"saved_by" uuid,
	"draft" jsonb,
	"draft_loaded_at" timestamp with time zone,
	"draft_loaded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "vat_worksheets" ADD CONSTRAINT "vat_worksheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_worksheets" ADD CONSTRAINT "vat_worksheets_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_worksheets" ADD CONSTRAINT "vat_worksheets_draft_loaded_by_users_id_fk" FOREIGN KEY ("draft_loaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_worksheets_tenant_year" ON "vat_worksheets" USING btree ("tenant_id","fiscal_year_key");