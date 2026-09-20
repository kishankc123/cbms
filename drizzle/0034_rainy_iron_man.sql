CREATE TYPE "public"."obligation_source" AS ENUM('generated', 'manual', 'migrated');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('pending', 'in_progress', 'filed', 'paid', 'partially_paid', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."requirement_frequency" AS ENUM('monthly', 'quarterly', 'annual', 'one_time', 'event_based');--> statement-breakpoint
CREATE TABLE "account_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_countries" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"statutory_calendar" text DEFAULT 'AD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_entity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid,
	"source" "obligation_source" DEFAULT 'manual' NOT NULL,
	"name" text NOT NULL,
	"category_key" text NOT NULL,
	"tax_type_key" text,
	"period_key" text,
	"period_label" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"due_date" date NOT NULL,
	"status" "obligation_status" DEFAULT 'pending' NOT NULL,
	"not_applicable_reason" text,
	"filing_date" date,
	"payment_due_date" date,
	"payment_date" date,
	"amount_due" numeric(18, 2),
	"filing_reference" text,
	"payment_reference" text,
	"supporting_document" text,
	"notes" text,
	"responsible_user_id" uuid,
	"legacy_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_requirement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"entity_type_key" text,
	"category_key" text NOT NULL,
	"tax_type_key" text,
	"authority_key" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"frequency" "requirement_frequency" NOT NULL,
	"period_calendar" text DEFAULT 'statutory' NOT NULL,
	"applicability" jsonb,
	"due_rule" jsonb,
	"active_from" date,
	"active_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_tax_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"authority_key" text,
	"payable_account_name" text,
	"legacy_payable_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country_code" text DEFAULT 'NP' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_authorities" ADD CONSTRAINT "compliance_authorities_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_entity_types" ADD CONSTRAINT "compliance_entity_types_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_template_id_compliance_requirement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."compliance_requirement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_category_key_compliance_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."compliance_categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_requirement_templates" ADD CONSTRAINT "compliance_requirement_templates_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_requirement_templates" ADD CONSTRAINT "compliance_requirement_templates_category_key_compliance_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."compliance_categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tax_types" ADD CONSTRAINT "compliance_tax_types_country_code_compliance_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."compliance_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_roles_tenant_role" ON "account_roles" USING btree ("tenant_id","role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_authorities_country_key" ON "compliance_authorities" USING btree ("country_code","key");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_entity_types_country_key" ON "compliance_entity_types" USING btree ("country_code","key");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_obligations_template_period" ON "compliance_obligations" USING btree ("tenant_id","template_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_obligations_legacy_item" ON "compliance_obligations" USING btree ("legacy_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_requirement_templates_country_key" ON "compliance_requirement_templates" USING btree ("country_code","key");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_tax_types_country_key" ON "compliance_tax_types" USING btree ("country_code","key");