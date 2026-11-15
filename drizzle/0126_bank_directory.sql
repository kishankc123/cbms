CREATE TABLE "bank_institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"logo" text,
	"logo_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "institution_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_institutions" ADD CONSTRAINT "bank_institutions_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_institutions_country_name" ON "bank_institutions" USING btree ("country_code",lower("name"));--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_institution_id_bank_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."bank_institutions"("id") ON DELETE no action ON UPDATE no action;