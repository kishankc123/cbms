CREATE TABLE "platform_tax_rate_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"tax_type_key" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_tax_rate_drafts" ADD CONSTRAINT "platform_tax_rate_drafts_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_tax_rate_drafts_country_type_from" ON "platform_tax_rate_drafts" USING btree ("country_code","tax_type_key","effective_from");