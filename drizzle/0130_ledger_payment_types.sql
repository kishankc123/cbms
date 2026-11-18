ALTER TYPE "public"."payment_type" ADD VALUE 'ledger_receipt' BEFORE 'supplier_payment';--> statement-breakpoint
ALTER TYPE "public"."payment_type" ADD VALUE 'ledger_payment';