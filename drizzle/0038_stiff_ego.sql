CREATE TYPE "public"."capital_change_type" AS ENUM('initial_setup', 'authorised_capital_increase', 'shares_issued', 'paid_up_capital_increase', 'share_transfer', 'share_cancellation', 'face_value_change', 'capital_assignment', 'shareholder_added', 'shareholder_deactivated', 'other');--> statement-breakpoint
CREATE TYPE "public"."share_lagat_status" AS ENUM('updated', 'update_required');--> statement-breakpoint
CREATE TYPE "public"."shareholder_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "capital_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_type" "capital_change_type" NOT NULL,
	"effective_date" date NOT NULL,
	"shareholder_id" uuid,
	"to_shareholder_id" uuid,
	"shares" integer,
	"amount" numeric(18, 2),
	"previous_value" numeric(18, 2),
	"new_value" numeric(18, 2),
	"reason" text,
	"reference_number" text,
	"supporting_document" text,
	"notes" text,
	"journal_entry_id" uuid,
	"payment_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_lagat_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "share_lagat_status" NOT NULL,
	"last_updated_date" date,
	"last_change_date" date,
	"reason" text,
	"reference_number" text,
	"supporting_document" text,
	"notes" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"capital_change_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shareholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"holder_type" text DEFAULT 'individual' NOT NULL,
	"share_class" text DEFAULT 'Ordinary' NOT NULL,
	"shares_held" integer DEFAULT 0 NOT NULL,
	"date_acquired" date,
	"status" "shareholder_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"capital_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_capital" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"authorised_capital" numeric(18, 2) DEFAULT '0' NOT NULL,
	"issued_shares" integer DEFAULT 0 NOT NULL,
	"face_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'NPR' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capital_changes" ADD CONSTRAINT "capital_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_changes" ADD CONSTRAINT "capital_changes_shareholder_id_shareholders_id_fk" FOREIGN KEY ("shareholder_id") REFERENCES "public"."shareholders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_changes" ADD CONSTRAINT "capital_changes_to_shareholder_id_shareholders_id_fk" FOREIGN KEY ("to_shareholder_id") REFERENCES "public"."shareholders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_changes" ADD CONSTRAINT "capital_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_lagat_entries" ADD CONSTRAINT "share_lagat_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_lagat_entries" ADD CONSTRAINT "share_lagat_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_capital_account_id_accounts_id_fk" FOREIGN KEY ("capital_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_capital" ADD CONSTRAINT "tenant_capital_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;