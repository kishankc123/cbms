CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."account_category" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."journal_source_type" AS ENUM('sale', 'purchase', 'expense', 'payment', 'receipt', 'bank_adjustment', 'manual');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('draft', 'open', 'paid', 'partially_paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('unmatched', 'auto_matched', 'manually_matched', 'ignored');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_value" jsonb,
	"after_value" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"industry" text,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"base_currency" text DEFAULT 'NPR' NOT NULL,
	"tax_registration_number" text,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" "account_category" NOT NULL,
	"sub_category" text,
	"parent_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_date" timestamp with time zone NOT NULL,
	"reference_number" text,
	"source_type" "journal_source_type" NOT NULL,
	"source_id" uuid,
	"memo" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_reversed" boolean DEFAULT false NOT NULL,
	"reversal_of_id" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_info" jsonb,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"amount_paid" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"bill_number" text NOT NULL,
	"bill_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"status" "bill_status" DEFAULT 'draft' NOT NULL,
	"amount_paid" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_info" jsonb,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_date" timestamp with time zone NOT NULL,
	"category_account_id" uuid NOT NULL,
	"vendor_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_method" text,
	"attachment_url" text,
	"notes" text,
	"bank_account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_name" text NOT NULL,
	"account_number_masked" text,
	"currency" text DEFAULT 'NPR' NOT NULL,
	"chart_of_accounts_link" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"imported_file_reference" text,
	"import_date" timestamp with time zone DEFAULT now() NOT NULL,
	"statement_period_start" timestamp with time zone NOT NULL,
	"statement_period_end" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"description" text,
	"amount" numeric(18, 2) NOT NULL,
	"matched_journal_line_id" uuid,
	"match_status" "match_status" DEFAULT 'unmatched' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_date" timestamp with time zone NOT NULL,
	"paid_to_vendor_id" uuid,
	"paid_to_other" text,
	"amount" numeric(18, 2) NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"applied_to_bill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_date" timestamp with time zone NOT NULL,
	"received_from_customer_id" uuid,
	"received_from_other" text,
	"amount" numeric(18, 2) NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"applied_to_invoice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_journal_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_account_id_accounts_id_fk" FOREIGN KEY ("category_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_chart_of_accounts_link_accounts_id_fk" FOREIGN KEY ("chart_of_accounts_link") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_id_bank_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("matched_journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;