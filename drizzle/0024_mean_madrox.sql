CREATE TYPE "public"."bank_statement_import_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('unmatched', 'suggested', 'matched', 'ignored', 'exception');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_match_type" AS ENUM('exact', 'suggested', 'manual');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('in_progress', 'reconciled', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."unmatched_ledger_classification" AS ENUM('outstanding_cheque', 'pending_bank_transaction', 'not_yet_cleared', 'timing_difference', 'incorrect_transaction');--> statement-breakpoint
CREATE TABLE "bank_reconciliation_match_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL,
	"amount_applied" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_match_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"statement_line_id" uuid NOT NULL,
	"amount_applied" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"match_type" "reconciliation_match_type" NOT NULL,
	"confidence" numeric(5, 2),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unmatched_by" uuid,
	"unmatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"statement_balance" numeric(18, 2) NOT NULL,
	"ledger_balance" numeric(18, 2) NOT NULL,
	"status" "reconciliation_status" DEFAULT 'in_progress' NOT NULL,
	"reconciled_by" uuid,
	"reconciled_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"file_name" text,
	"imported_file_reference" text,
	"import_date" timestamp with time zone DEFAULT now() NOT NULL,
	"statement_period_start" date NOT NULL,
	"statement_period_end" date NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" "bank_statement_import_status" DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text,
	"reference" text,
	"amount" numeric(18, 2) NOT NULL,
	"running_balance" numeric(18, 2),
	"dedupe_hash" text NOT NULL,
	"match_status" "match_status" DEFAULT 'unmatched' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmatched_ledger_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL,
	"classification" "unmatched_ledger_classification" NOT NULL,
	"notes" text,
	"classified_by" uuid NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_match_journal_lines" ADD CONSTRAINT "bank_reconciliation_match_journal_lines_match_id_bank_reconciliation_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."bank_reconciliation_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_match_journal_lines" ADD CONSTRAINT "bank_reconciliation_match_journal_lines_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_match_lines" ADD CONSTRAINT "bank_reconciliation_match_lines_match_id_bank_reconciliation_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."bank_reconciliation_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_match_lines" ADD CONSTRAINT "bank_reconciliation_match_lines_statement_line_id_bank_statement_lines_id_fk" FOREIGN KEY ("statement_line_id") REFERENCES "public"."bank_statement_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_unmatched_by_users_id_fk" FOREIGN KEY ("unmatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_id_bank_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_templates" ADD CONSTRAINT "bank_statement_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_templates" ADD CONSTRAINT "bank_statement_templates_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_ledger_classifications" ADD CONSTRAINT "unmatched_ledger_classifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_ledger_classifications" ADD CONSTRAINT "unmatched_ledger_classifications_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_ledger_classifications" ADD CONSTRAINT "unmatched_ledger_classifications_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_ledger_classifications" ADD CONSTRAINT "unmatched_ledger_classifications_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;