CREATE INDEX "journal_entries_tenant_date" ON "journal_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_source" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_reversal_of" ON "journal_entries" USING btree ("reversal_of_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry" ON "journal_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_tenant_due" ON "sales_invoices" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "purchase_bills_tenant_due" ON "purchase_bills" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "expenses_tenant_due" ON "expenses" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "payments_tenant_date" ON "payments_ledger" USING btree ("tenant_id","payment_date");