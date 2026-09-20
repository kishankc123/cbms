CREATE TYPE "public"."assessment_kind" AS ENUM('assessment', 'penalty', 'interest');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('active', 'inactive', 'suspended', 'deregistered');--> statement-breakpoint
ALTER TYPE "public"."payment_allocation_target" ADD VALUE 'tax_obligation';--> statement-breakpoint
CREATE TABLE "compliance_tax_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obligation_id" uuid,
	"tax_type_key" text NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"assessment_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"description" text,
	"reference_number" text,
	"expense_account_id" uuid NOT NULL,
	"payable_account_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"status" "assessment_status" DEFAULT 'posted' NOT NULL,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tax_type_key" text NOT NULL,
	"registration_number" text,
	"registration_date" date,
	"effective_date" date,
	"deregistration_date" date,
	"status" "registration_status" DEFAULT 'active' NOT NULL,
	"authority_key" text,
	"supporting_document" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trading_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_registration_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "registration_date" date;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "registered_office" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "pan_vat_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_status_note" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "pan_number" text;--> statement-breakpoint
ALTER TABLE "compliance_tax_types" ADD COLUMN "is_registrable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_tax_assessments" ADD CONSTRAINT "compliance_tax_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tax_assessments" ADD CONSTRAINT "compliance_tax_assessments_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tax_assessments" ADD CONSTRAINT "compliance_tax_assessments_payable_account_id_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tax_assessments" ADD CONSTRAINT "compliance_tax_assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_tax_registrations" ADD CONSTRAINT "tenant_tax_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_tax_registrations_tenant_type" ON "tenant_tax_registrations" USING btree ("tenant_id","tax_type_key");--> statement-breakpoint
UPDATE "tenants" SET "pan_vat_number" = COALESCE(NULLIF(TRIM("vat_registration_number"), ''), NULLIF(TRIM("tax_registration_number"), ''));--> statement-breakpoint
UPDATE "compliance_tax_types" SET "is_registrable" = true WHERE "key" IN ('pan', 'vat', 'tds', 'excise');--> statement-breakpoint
INSERT INTO "tenant_tax_registrations" ("tenant_id", "tax_type_key", "status") SELECT "id", 'pan', 'active' FROM "tenants" WHERE "pan_vat_number" IS NOT NULL;--> statement-breakpoint
INSERT INTO "tenant_tax_registrations" ("tenant_id", "tax_type_key", "status") SELECT "id", 'vat', 'active' FROM "tenants" WHERE NULLIF(TRIM("vat_registration_number"), '') IS NOT NULL;
