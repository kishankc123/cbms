CREATE TABLE "platform_slab_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"head_key" text NOT NULL,
	"effective_from" date NOT NULL,
	"tables" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_slab_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"head_key" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"tables" jsonb NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_slab_drafts" ADD CONSTRAINT "platform_slab_drafts_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_slab_versions" ADD CONSTRAINT "platform_slab_versions_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_slab_versions" ADD CONSTRAINT "platform_slab_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_slab_drafts_country_head_from" ON "platform_slab_drafts" USING btree ("country_code","head_key","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_slab_versions_country_head_from" ON "platform_slab_versions" USING btree ("country_code","head_key","effective_from");