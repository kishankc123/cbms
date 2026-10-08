CREATE TABLE "excise_renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_year_start" date NOT NULL,
	"paid_date" date NOT NULL,
	"fee_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"penalty_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"receipt_reference" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_tax_registrations" ADD COLUMN "standard_renewal_fee" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "excise_renewals" ADD CONSTRAINT "excise_renewals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "excise_renewals_tenant_year" ON "excise_renewals" USING btree ("tenant_id","fiscal_year_start");