CREATE TABLE "compliance_penalty_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"tax_type_key" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"params" jsonb NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_penalty_rules" ADD CONSTRAINT "compliance_penalty_rules_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_penalty_rules_country_type_from" ON "compliance_penalty_rules" USING btree ("country_code","tax_type_key","effective_from");