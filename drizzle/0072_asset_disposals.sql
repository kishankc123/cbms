CREATE TABLE "asset_disposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"disposal_date" date NOT NULL,
	"customer_id" uuid,
	"invoice_number" text,
	"tax_treatment" text DEFAULT 'none' NOT NULL,
	"sale_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"received_account_id" uuid,
	"cost" numeric(18, 2) NOT NULL,
	"accumulated_depreciation" numeric(18, 2) NOT NULL,
	"net_book_value" numeric(18, 2) NOT NULL,
	"gain_loss" numeric(18, 2) NOT NULL,
	"reason" text,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_disposals_tenant_reference" ON "asset_disposals" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "asset_disposals_asset" ON "asset_disposals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_disposals_tenant_date" ON "asset_disposals" USING btree ("tenant_id","disposal_date");