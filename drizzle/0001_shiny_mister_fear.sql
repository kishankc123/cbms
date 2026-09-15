ALTER TABLE "journal_entries" ALTER COLUMN "entry_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "sales_invoices" ALTER COLUMN "invoice_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "sales_invoices" ALTER COLUMN "due_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "purchase_bills" ALTER COLUMN "bill_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "purchase_bills" ALTER COLUMN "due_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "expense_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ALTER COLUMN "statement_period_start" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ALTER COLUMN "statement_period_end" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ALTER COLUMN "transaction_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "payment_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "receipt_date" SET DATA TYPE date;