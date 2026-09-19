CREATE TYPE "public"."payment_allocation_target" AS ENUM('sales_invoice', 'purchase_bill', 'expense');--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('money_in', 'money_out');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'cheque', 'card', 'online', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_origin" AS ENUM('standalone', 'embedded');--> statement-breakpoint
CREATE TYPE "public"."payment_party_type" AS ENUM('customer', 'supplier', 'employee', 'other', 'none');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('draft', 'posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('customer_payment', 'customer_advance', 'loan_received', 'capital_introduced', 'refund_received', 'other_receipt', 'supplier_payment', 'expense_payment', 'tax_payment', 'loan_repayment', 'supplier_advance', 'owner_withdrawal', 'cash_withdrawal', 'bank_transfer', 'other_payment');--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"target_type" "payment_allocation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"allocated_amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_number" text NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"payment_type" "payment_type" NOT NULL,
	"payment_date" date NOT NULL,
	"party_type" "payment_party_type" DEFAULT 'none' NOT NULL,
	"customer_id" uuid,
	"vendor_id" uuid,
	"employee_id" uuid,
	"party_other_name" text,
	"account_id" uuid NOT NULL,
	"transfer_to_account_id" uuid,
	"category_account_id" uuid,
	"payment_method" "payment_method" DEFAULT 'cash' NOT NULL,
	"cheque_number" text,
	"cheque_date" date,
	"cheque_bank" text,
	"reference_number" text,
	"amount" numeric(18, 2) NOT NULL,
	"description" text,
	"notes" text,
	"attachment_url" text,
	"status" "payment_status" DEFAULT 'posted' NOT NULL,
	"origin" "payment_origin" DEFAULT 'standalone' NOT NULL,
	"journal_entry_id" uuid,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_ledger_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_transfer_to_account_id_accounts_id_fk" FOREIGN KEY ("transfer_to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_category_account_id_accounts_id_fk" FOREIGN KEY ("category_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;