CREATE TABLE "issued_cheques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"cheque_number" text NOT NULL,
	"payee_kind" text NOT NULL,
	"vendor_id" uuid,
	"expense_id" uuid,
	"payee_name" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"issue_date" date NOT NULL,
	"cheque_date" date NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"cleared_date" date,
	"payment_id" uuid,
	"closed_reason" text,
	"replaces_id" uuid,
	"memo" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_payment_id_payments_ledger_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_replaces_id_issued_cheques_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."issued_cheques"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_cheques" ADD CONSTRAINT "issued_cheques_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_cheques_account_number" ON "issued_cheques" USING btree ("tenant_id","bank_account_id","cheque_number");--> statement-breakpoint
CREATE INDEX "issued_cheques_tenant_status" ON "issued_cheques" USING btree ("tenant_id","status","cheque_date");