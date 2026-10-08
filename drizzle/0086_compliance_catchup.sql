CREATE TABLE "compliance_catchup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"filed_through" date,
	"answered_by" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "filed_before_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_catchup" ADD CONSTRAINT "compliance_catchup_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_catchup_tenant_stream" ON "compliance_catchup" USING btree ("tenant_id","stream");--> statement-breakpoint
-- The annual income tax return and the excise return are tracked from the catch-up checklist, so they are switched on. The due
-- rules are the ones already in the configuration (income tax: end of Ashwin; excise: the 25th of the following month); they are
-- not verified yet, and a platform administrator can change them.
UPDATE "compliance_requirement_templates" SET "is_active" = true WHERE "country_code" = 'NP' AND "key" IN ('income_tax_return', 'excise_return');
