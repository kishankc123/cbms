DROP INDEX "payment_mode_accounts_mode";--> statement-breakpoint
DROP INDEX "payment_mode_accounts_account";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_mode_accounts_mode_account" ON "payment_mode_accounts" USING btree ("mode_id","account_id");--> statement-breakpoint
CREATE INDEX "payment_mode_accounts_account" ON "payment_mode_accounts" USING btree ("account_id");