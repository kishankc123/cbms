ALTER TABLE "recurring_expenses" ADD COLUMN "expected_payment_mode_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "expected_payment_mode_name" text;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD COLUMN "from_payment_mode_id" uuid;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD COLUMN "from_payment_mode_name" text;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD COLUMN "to_payment_mode_id" uuid;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD COLUMN "to_payment_mode_name" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_expected_payment_mode_id_payment_modes_id_fk" FOREIGN KEY ("expected_payment_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD CONSTRAINT "inter_transfers_from_payment_mode_id_payment_modes_id_fk" FOREIGN KEY ("from_payment_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_transfers" ADD CONSTRAINT "inter_transfers_to_payment_mode_id_payment_modes_id_fk" FOREIGN KEY ("to_payment_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE set null ON UPDATE no action;