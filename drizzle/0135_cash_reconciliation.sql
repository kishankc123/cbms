CREATE TABLE "cash_difference_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recon_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expense_id" uuid,
	"entry_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"explained_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_reconciliation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recon_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"opening" numeric(18, 2) NOT NULL,
	"ticked_in" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ticked_out" numeric(18, 2) DEFAULT '0' NOT NULL,
	"difference" numeric(18, 2),
	"adjustment" numeric(18, 2) DEFAULT '0' NOT NULL,
	"adjustment_entry_id" uuid,
	"closing" numeric(18, 2) NOT NULL,
	"kind" text DEFAULT 'confirmed' NOT NULL,
	"count_id" uuid,
	"counted_total" numeric(18, 2),
	"note" text,
	"status" text DEFAULT 'reconciled' NOT NULL,
	"reconciled_by" uuid,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text
);
--> statement-breakpoint
ALTER TABLE "cash_difference_explanations" ADD CONSTRAINT "cash_difference_explanations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_difference_explanations" ADD CONSTRAINT "cash_difference_explanations_recon_id_cash_reconciliations_id_fk" FOREIGN KEY ("recon_id") REFERENCES "public"."cash_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_difference_explanations" ADD CONSTRAINT "cash_difference_explanations_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_difference_explanations" ADD CONSTRAINT "cash_difference_explanations_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_difference_explanations" ADD CONSTRAINT "cash_difference_explanations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliation_lines" ADD CONSTRAINT "cash_reconciliation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliation_lines" ADD CONSTRAINT "cash_reconciliation_lines_recon_id_cash_reconciliations_id_fk" FOREIGN KEY ("recon_id") REFERENCES "public"."cash_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliation_lines" ADD CONSTRAINT "cash_reconciliation_lines_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_adjustment_entry_id_journal_entries_id_fk" FOREIGN KEY ("adjustment_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_count_id_daybook_cash_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."daybook_cash_counts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_explanations_recon" ON "cash_difference_explanations" USING btree ("tenant_id","recon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_recon_lines_line" ON "cash_reconciliation_lines" USING btree ("tenant_id","journal_line_id");--> statement-breakpoint
CREATE INDEX "cash_recon_lines_recon" ON "cash_reconciliation_lines" USING btree ("recon_id");--> statement-breakpoint
CREATE INDEX "cash_recon_tenant_account" ON "cash_reconciliations" USING btree ("tenant_id","account_id","as_of_date");