ALTER TABLE "customers" ADD COLUMN "receivable_account_id" uuid;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "payable_account_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_receivable_account_id_accounts_id_fk" FOREIGN KEY ("receivable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_payable_account_id_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;