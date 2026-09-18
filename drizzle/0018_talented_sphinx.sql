ALTER TYPE "public"."journal_source_type" ADD VALUE 'payroll';--> statement-breakpoint
ALTER TYPE "public"."journal_source_type" ADD VALUE 'opening_balance';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_quantity" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payable_account_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_payable_account_id_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;