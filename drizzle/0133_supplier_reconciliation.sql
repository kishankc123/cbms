CREATE TYPE "public"."supplier_recon_status" AS ENUM('draft', 'reconciled');--> statement-breakpoint
CREATE TABLE "supplier_recon_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recon_id" uuid NOT NULL,
	"their_line_id" uuid,
	"entry_id" uuid,
	"reason" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "supplier_recon_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recon_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"tx_date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"effect" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_recon_match_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"recon_id" uuid NOT NULL,
	"their_line_id" uuid,
	"entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "supplier_recon_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recon_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"orientation" text DEFAULT 'credit_is_bill' NOT NULL,
	"their_opening" numeric(18, 2) DEFAULT '0' NOT NULL,
	"their_closing" numeric(18, 2) DEFAULT '0' NOT NULL,
	"date_tolerance_days" integer DEFAULT 7 NOT NULL,
	"amount_tolerance" numeric(18, 2) DEFAULT '1' NOT NULL,
	"status" "supplier_recon_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "supplier_recon_flags" ADD CONSTRAINT "supplier_recon_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_flags" ADD CONSTRAINT "supplier_recon_flags_recon_id_supplier_reconciliations_id_fk" FOREIGN KEY ("recon_id") REFERENCES "public"."supplier_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_flags" ADD CONSTRAINT "supplier_recon_flags_their_line_id_supplier_recon_lines_id_fk" FOREIGN KEY ("their_line_id") REFERENCES "public"."supplier_recon_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_lines" ADD CONSTRAINT "supplier_recon_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_lines" ADD CONSTRAINT "supplier_recon_lines_recon_id_supplier_reconciliations_id_fk" FOREIGN KEY ("recon_id") REFERENCES "public"."supplier_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_match_items" ADD CONSTRAINT "supplier_recon_match_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_match_items" ADD CONSTRAINT "supplier_recon_match_items_match_id_supplier_recon_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."supplier_recon_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_match_items" ADD CONSTRAINT "supplier_recon_match_items_recon_id_supplier_reconciliations_id_fk" FOREIGN KEY ("recon_id") REFERENCES "public"."supplier_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_match_items" ADD CONSTRAINT "supplier_recon_match_items_their_line_id_supplier_recon_lines_id_fk" FOREIGN KEY ("their_line_id") REFERENCES "public"."supplier_recon_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_matches" ADD CONSTRAINT "supplier_recon_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_recon_matches" ADD CONSTRAINT "supplier_recon_matches_recon_id_supplier_reconciliations_id_fk" FOREIGN KEY ("recon_id") REFERENCES "public"."supplier_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reconciliations" ADD CONSTRAINT "supplier_reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reconciliations" ADD CONSTRAINT "supplier_reconciliations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reconciliations" ADD CONSTRAINT "supplier_reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reconciliations" ADD CONSTRAINT "supplier_reconciliations_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_recon_items_recon" ON "supplier_recon_match_items" USING btree ("recon_id");--> statement-breakpoint
CREATE INDEX "supplier_recon_tenant_vendor" ON "supplier_reconciliations" USING btree ("tenant_id","vendor_id");