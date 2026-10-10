CREATE TABLE "platform_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"tax_type_key" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_verified" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_tax_rates" ADD CONSTRAINT "platform_tax_rates_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_tax_rates" ADD CONSTRAINT "platform_tax_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_tax_rates_country_type_from" ON "platform_tax_rates" USING btree ("country_code","tax_type_key","effective_from");