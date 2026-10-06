ALTER TABLE "memberships" ADD COLUMN "member_number" integer;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notice_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_number_idx" ON "memberships" USING btree ("tenant_id","member_number");