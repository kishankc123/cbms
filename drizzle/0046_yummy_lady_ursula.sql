ALTER TYPE "public"."payment_type" ADD VALUE 'customer_refund' BEFORE 'expense_payment';--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"return_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_applications_return" ON "credit_applications" USING btree ("tenant_id","return_id");--> statement-breakpoint
CREATE INDEX "credit_applications_target" ON "credit_applications" USING btree ("tenant_id","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_number" ON "payments_ledger" USING btree ("tenant_id","payment_number");