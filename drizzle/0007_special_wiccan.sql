CREATE TABLE "cash_purchase_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_purchase_categories" ADD CONSTRAINT "cash_purchase_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_category_id_cash_purchase_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cash_purchase_categories"("id") ON DELETE no action ON UPDATE no action;