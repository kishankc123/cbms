CREATE TYPE "public"."expense_status" AS ENUM('unpaid', 'partially_paid', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."expense_tax_treatment" AS ENUM('taxable', 'exempt', 'zero_rated');--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "tax_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "tax_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tds_rate" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "expense_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payee_name" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "invoice_date" date;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tax_treatment" "expense_tax_treatment" DEFAULT 'taxable' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "taxable_amount" numeric(18, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tds_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "other_tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "subtotal" numeric(18, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "total" numeric(18, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "amount_payable" numeric(18, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "amount_paid" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "status" "expense_status" DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;