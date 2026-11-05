CREATE TABLE "received_cheques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"payer_name" text NOT NULL,
	"drawer_bank" text NOT NULL,
	"cheque_number" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"received_date" date NOT NULL,
	"cheque_date" date NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"deposit_account_id" uuid,
	"deposited_date" date,
	"cleared_date" date,
	"payment_id" uuid,
	"closed_reason" text,
	"memo" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "received_cheques" ADD CONSTRAINT "received_cheques_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_cheques" ADD CONSTRAINT "received_cheques_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_cheques" ADD CONSTRAINT "received_cheques_deposit_account_id_accounts_id_fk" FOREIGN KEY ("deposit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_cheques" ADD CONSTRAINT "received_cheques_payment_id_payments_ledger_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_cheques" ADD CONSTRAINT "received_cheques_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "received_cheques_unique" ON "received_cheques" USING btree ("tenant_id","customer_id","drawer_bank","cheque_number");--> statement-breakpoint
CREATE INDEX "received_cheques_tenant_status" ON "received_cheques" USING btree ("tenant_id","status","cheque_date");