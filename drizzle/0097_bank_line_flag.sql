ALTER TABLE "bank_statement_lines" ADD COLUMN "flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD COLUMN "flagged_by" uuid;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD COLUMN "flag_note" text;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_flagged_by_users_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;