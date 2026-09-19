CREATE TYPE "public"."inter_transfer_status" AS ENUM('posted', 'voided');--> statement-breakpoint
ALTER TYPE "public"."journal_source_type" ADD VALUE 'inter_transfer';--> statement-breakpoint
CREATE TABLE "inter_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_number" text NOT NULL,
	"transfer_date" date NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reference" text,
	"description" text,
	"attachment_url" text,
	"status" "inter_transfer_status" DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD CONSTRAINT "inter_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD CONSTRAINT "inter_transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD CONSTRAINT "inter_transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD CONSTRAINT "inter_transfers_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inter_transfers_tenant_number_idx" ON "inter_transfers" USING btree ("tenant_id","transfer_number");