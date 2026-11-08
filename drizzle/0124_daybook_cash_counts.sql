CREATE TABLE "daybook_cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"count_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"other_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"counted_total" numeric(18, 2) NOT NULL,
	"book_balance" numeric(18, 2) NOT NULL,
	"remark" text,
	"counted_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daybook_cash_counts" ADD CONSTRAINT "daybook_cash_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daybook_cash_counts" ADD CONSTRAINT "daybook_cash_counts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daybook_cash_counts_day_account" ON "daybook_cash_counts" USING btree ("tenant_id","count_date","account_id");