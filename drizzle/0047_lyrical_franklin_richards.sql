ALTER TYPE "public"."journal_source_type" ADD VALUE 'advance_application';--> statement-breakpoint
CREATE TABLE "advance_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"side" text NOT NULL,
	"party_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "advance_account_id" uuid;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "advance_account_id" uuid;--> statement-breakpoint
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_applications_target" ON "advance_applications" USING btree ("tenant_id","target_id");--> statement-breakpoint
CREATE INDEX "advance_applications_party" ON "advance_applications" USING btree ("tenant_id","party_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_advance_account_id_accounts_id_fk" FOREIGN KEY ("advance_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_advance_account_id_accounts_id_fk" FOREIGN KEY ("advance_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;