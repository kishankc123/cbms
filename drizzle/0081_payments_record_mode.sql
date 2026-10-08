ALTER TABLE "payments_ledger" ADD COLUMN "payment_mode_id" uuid;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD COLUMN "payment_mode_name" text;--> statement-breakpoint
ALTER TABLE "payments_ledger" ADD CONSTRAINT "payments_ledger_payment_mode_id_payment_modes_id_fk" FOREIGN KEY ("payment_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE set null ON UPDATE no action;